// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Api } from './index.d';
import * as vscode from 'vscode';
import { watch } from 'chokidar';
import { diffChars } from 'diff';
import { observe } from 'mobx';
import { CancellationToken, commands, DiagnosticSeverity, Disposable, ExtensionContext, languages, OutputChannel, TextDocument, Uri, window, workspace } from 'vscode';
import '../shared/extension';
import { getOriginalDoc } from './getOriginalDoc';
import { activateDecorations } from './index.activateDecorations';
import { activateFixes } from './index.activateFixes';
import { activateGithubAnalyses } from './index.activateGithubAnalyses';
import { activateGithubCommands } from './index.activateGithubCommands';
import { loadLogs } from './loadLogs';
import { Panel } from './panel';
import { driftedRegionToSelection } from './regionToSelection';
import { ResultDiagnostic } from './resultDiagnostic';
import { activateSarifStatusBarItem } from './statusBarItem';
import { Store } from './store';
import * as Telemetry from './telemetry';
import { update, updateChannelConfigSection } from './update';
import { UriRebaser } from './uriRebaser';
import { promises } from 'fs';
import * as os from 'os';
import * as path from 'path';
import fetch from 'node-fetch';

export async function activate(context: ExtensionContext): Promise<Api> {
    // Borrowed from: https://github.com/Microsoft/vscode-languageserver-node/blob/db0f0f8c06b89923f96a8a5aebc8a4b5bb3018ad/client/src/main.ts#L217
    const isDebugOrTestMode =
        process.execArgv.some(arg => /^--extensionTestsPath=?/.test(arg)) // Debug
        || process.execArgv.some(arg => /^--(debug|debug-brk|inspect|inspect-brk)=?/.test(arg)); // Test

    if (!isDebugOrTestMode) Telemetry.activate();

    const disposables = context.subscriptions;

    const outputChannel = window.createOutputChannel('Sarif Viewer');
    disposables.push(outputChannel);

    Store.globalState = context.globalState;
    disposables.push(commands.registerCommand('sarif.clearState', () => {
        context.globalState.update('view', undefined);
        commands.executeCommand('workbench.action.reloadWindow');
    }));
    const store = new Store();

    // Basing
    const baser = new UriRebaser(store);

    // Panel
    const panel = new Panel(context, baser, store);
    disposables.push(commands.registerCommand('sarif.showPanel', () => panel.show()));

    // URI handler
    disposables.push(window.registerUriHandler({
        async handleUri(uri: vscode.Uri) {
            if (uri.path.toLowerCase() === '/alert') {
                // Launched by Azure DevOps Advanced Security alert page.
                const param = uri.query.split('url=');

                // Decode the alert API URL and pass it to the load function.
                const url = decodeURIComponent(param[1]);
                if (url.startsWith('https://advsec.dev.azure.com/')) {
                    await loadAlertSarif(new URL(url));
                } else {
                    void window.showWarningMessage(`Invalid callback URL '${url}'. URL must point to 'https://advsec.dev.azure.com/'.`, 'OK');
                }
            }
        }
    }));

    async function loadAlertSarif(url: URL) {
        try {
            // Get the user's session with the ADO service's user_impersonation scope
            const session = await vscode.authentication.getSession('microsoft', ['499b84ac-1321-427f-aa17-267ca6975798/.default'], { createIfNone: true });
            const accessToken = session?.accessToken;

            if (!accessToken) { return; }

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/sarif+json',
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'MS-SarifVSCode.sarif-viewer',
                }
            });

            if (response.ok) {
                // Save the log to a new temp file.
                const filePath = path.join(os.tmpdir(), `${(new Date()).getTime()}.sarif`);

                try {
                    const jsonObject = await response.json();
                    await promises.writeFile(filePath, jsonObject.value);

                    // Load the log into the Viewer.
                    store.logs.push(...await loadLogs([Uri.file(filePath)]));
                    if (store.results.length) panel.show();
                } catch (error) {
                    outputChannel.appendLine(`***Exception in loadAlertSarif\n***${error}\n***File path: ${filePath}\n`);
                }
            } else {
                outputChannel.appendLine(`***Failed request in loadAlertSarif\n***Response code ${response.status} ${response.statusText}\n***URL: ${url.toString()}\n`);
            }
        } catch (error) {
            outputChannel.appendLine(`***Exception in loadAlertSarif\n***${error}\n***URL: ${url.toString()}\n`);
        }
    }

    // General Activation
    activateSarifStatusBarItem(disposables);
    activateDiagnostics(disposables, store, baser, outputChannel);
    activateWatchDocuments(disposables, store, panel);
    activateDecorations(disposables, store, baser);
    activateVirtualDocuments(disposables, store);
    activateSelectionSync(disposables, store, panel);
    activateGithubAnalyses(disposables, store, panel, outputChannel);
    activateGithubCommands(disposables, store, outputChannel);
    activateFixes(disposables, store, baser);

    // Check for Updates
    if (!isDebugOrTestMode) {
        disposables.push(workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration(updateChannelConfigSection)) return;
            update();
        }));
        update();
    }

    // For now, we keep file watch functionality limited to the API.
    // After we're sure it's working well, consider also enabling it for files opened manually.
    // FIXME: Possible race condition if a file is changed multiple times in quick succession.
    // 1. First change event fires (denoted as [1]).
    // 2. [1] Log is removed from the store.
    // 3. Second change event fires (denoted as [2]).
    // 4. [2] Log is removed from the store (returns false as it's already been removed).
    // 5. [1] Log is re-loaded and added to the store.
    // 6. [2] Log is re-loaded and added (again!) to the store.
    const watcher = watch([], {
        ignoreInitial: true
    }).on('change', async path => {
        store.logs.removeFirst(log => log._uri === Uri.file(path).toString());
        store.logs.push(...await loadLogs([Uri.file(path)]));
    }).on('unlink', path => {
        store.logs.removeFirst(log => log._uri === Uri.file(path).toString());
    });
    disposables.push(new Disposable(async () => await watcher.close()));

    // API
    const api = {
        async openLogs(logs: Uri[], _options?: unknown, cancellationToken?: CancellationToken) {
            watcher.add(logs.map(log => log.fsPath));
            store.logs.push(...await loadLogs(logs, cancellationToken));
            if (cancellationToken ?.isCancellationRequested) return;
            if (store.results.length) {
                // TODO should we await?
                void panel.show();
            }
        },
        async closeLogs(logs: Uri[]) {
            watcher.unwatch(logs.map(log => log.fsPath));
            for (const uri of logs) {
                store.logs.removeFirst(log => log._uri === uri.toString());
            }
        },
        async closeAllLogs() {
            watcher.unwatch('**/*');
            store.logs.splice(0);
        },
        async selectByIndex(uri: Uri, runIndex: number, resultIndex: number) {
            panel.selectByIndex(uri, runIndex, resultIndex);
        },
        get uriBases() {
            return baser.uriBases.map(uri => Uri.file(uri)) as ReadonlyArray<Uri>;
        },
        set uriBases(values) {
            baser.uriBases = values.map(uri => uri.toString());
        },
        dispose: () => {
            Telemetry.deactivate();
            api.closeAllLogs();
            disposables.forEach(disposable => disposable ?.dispose ?.());
        }
    };

    // By convention, auto-open any logs in the `./.sarif` folder.
    await api.openLogs(await workspace.findFiles('.sarif/**.sarif'));

    // During development, use the following line to auto-load a log.
    // await api.openLogs([Uri.parse('/path/to/log.sarif')]);

    return api;
}

function activateDiagnostics(disposables: Disposable[], store: Store, baser: UriRebaser, outputChannel: OutputChannel) {
    const diagsAll = languages.createDiagnosticCollection('SARIF');
    disposables.push(diagsAll);
    const setDiags = async (doc: TextDocument) => {
        // When the user opens a doc, VS Code commonly silently opens the associate `*.git`. We are not interested in these events.
        if (doc.fileName.endsWith('.git')) return;
        if (doc.uri.scheme === 'output') return; // Example "output:extension-output-MS-SarifVSCode.sarif-viewer-%231-Sarif%20Viewer"
        if (doc.uri.scheme === 'vscode') return; // Example "vscode:scm/git/scm0/input?rootUri..."
        if (doc.uri.scheme === 'comment') return; // Represents a comment thread (from the VS Code Comments API)
        if (doc.uri.scheme === 'vscode-terminal') return; // Represents a terminal (either integrated or from the VS Code Terminal API)

        const artifactUri = await (async () => {
            if (doc.uri.scheme === 'sarif') {
                return doc.uri.toString();
            }
            return baser.translateLocalToArtifact(doc.uri);
        })();
        const severities = {
            error: DiagnosticSeverity.Error,
            warning: DiagnosticSeverity.Warning,
        } as Record<string, DiagnosticSeverity>;
        const matchingResults = store.results
            .filter(result => {
                const uri = result._uriContents ?? result._uri;
                return uri === artifactUri;
            });

        const workspaceUri = workspace.workspaceFolders?.[0]?.uri.toString() ?? 'file://';
        outputChannel.appendLine(`updateDiags ${doc.uri.toString().replace(workspaceUri, '')}. ${matchingResults.length} Results.\n`);

        if (!matchingResults.length) {
            diagsAll.set(doc.uri, []);
            return;
        }

        const currentDoc = doc; // Alias for juxtaposition.
        const originalDoc = await getOriginalDoc(store.analysisInfo?.commit_sha, currentDoc);
        const diffBlocks = originalDoc ? diffChars(originalDoc.getText(), currentDoc.getText()) : [];

        const diags = matchingResults
            .map(result => {
                return new ResultDiagnostic(
                    driftedRegionToSelection(diffBlocks, currentDoc, result._region, originalDoc),
                    result._message ?? '—',
                    severities[result.level ?? ''] ?? DiagnosticSeverity.Information, // note, none, undefined.
                    result,
                );
            });

        diagsAll.set(doc.uri, diags);
    };
    workspace.textDocuments.forEach(setDiags);
    disposables.push(workspace.onDidOpenTextDocument(setDiags));
    disposables.push(workspace.onDidCloseTextDocument(doc => diagsAll.delete(doc.uri))); // Spurious *.git deletes don't hurt.
    disposables.push(workspace.onDidChangeTextDocument(({ document }) => setDiags(document))); // TODO: Consider updating the regions independently of the list of diagnostics.

    const disposerStore = observe(store, 'results', () => workspace.textDocuments.forEach(setDiags));
    disposables.push({ dispose: disposerStore });
}

// Sync Open SARIF TextDocuments with Store.logs
function activateWatchDocuments(disposables: Disposable[], store: Store, panel: Panel) {
    const addLog = async (doc: TextDocument) => {
        if (!doc.fileName.match(/\.sarif$/i)) return;
        if (store.logs.some(log => log._uri === doc.uri.toString())) return; // TODO: Potentially redundant, need to verify.
        store.logs.push(...await loadLogs([doc.uri]));
        panel.show();
    };
    workspace.textDocuments.forEach(addLog);
    disposables.push(workspace.onDidOpenTextDocument(addLog));
    disposables.push(workspace.onDidCloseTextDocument(doc => {
        if (!doc.fileName.match(/\.sarif$/i)) return;
        store.logs.removeFirst(log => log._uri === doc.uri.toString());
    }));
}

function activateVirtualDocuments(disposables: Disposable[], store: Store) {
    disposables.push(workspace.registerTextDocumentContentProvider('sarif', {
        provideTextDocumentContent: (uri, token) => {
            const [logUriEncoded, runIndex, artifactIndex] = uri.path.split('/');
            const logUri = decodeURIComponent(logUriEncoded);
            const artifact = store.logs.find(log => log._uri === logUri)?.runs[+runIndex]?.artifacts?.[+artifactIndex];
            const contents = artifact?.contents;
            if (contents?.rendered?.markdown) return contents?.rendered?.markdown;
            if (contents?.rendered?.text) return contents?.rendered?.text;
            if (contents?.text) return contents?.text;
            if (contents?.binary) {
                const lines = Buffer.from(contents?.binary, 'base64').toString('hex').match(/.{1,32}/g);
                return lines?.reduce((sum, line, i) => {
                    const lineNo = ((i + 128) * 16).toString(16).toUpperCase().padStart(8, '0');
                    // eslint-disable-next-line no-control-regex
                    const preview = Buffer.from(line, 'hex').toString('utf8').replace(/(\x09|\x0A|\x0B|\x0C|\x0D|\x1B)/g, '?');
                    return `${sum}${lineNo}  ${line.toUpperCase().match(/.{1,2}/g)?.join(' ')}  ${preview}\n`;
                }, '') ?? '';
            }
            token.isCancellationRequested = true;
            return '';
        }
    }));
}

// Synchronize selection between editor and panel.
function activateSelectionSync(disposables: Disposable[], store: Store, panel: Panel) {
    disposables.push(window.onDidChangeTextEditorSelection(({ selections, textEditor }) => {
        if (store.disableSelectionSync) return; // See `panel.selectLocal` for details.

        // Anti-feedback-loop. Prevent panel-originated changes from echoing back to the panel.
        if (window.activeTextEditor !== textEditor) return;

        // Length 0  - I have yet to see this in practice.
        // Length 2+ - User is likely editing and does not want to be distracted by selection changes.
        if (selections.length !== 1) return;
        const selection = selections[0];
        const position = selection.isReversed ? selection.start : selection.end; // The blinking caret.

        const diagnostics = languages.getDiagnostics(textEditor.document.uri);
        const diagnostic = diagnostics.find(diagnostic => diagnostic.range.contains(position)) as ResultDiagnostic | undefined;
        const result = diagnostic?.result;
        if (!result) return;

        panel.select(result);
    }));
}
