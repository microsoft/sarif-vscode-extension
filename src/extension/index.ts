// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IArraySplice, observe } from 'mobx';
import { Log } from 'sarif';
import { CancellationToken, commands, DiagnosticSeverity, Disposable, ExtensionContext, languages, Range, TextDocument, ThemeColor, Uri, window, workspace } from 'vscode';
import { mapDistinct, parseRegion } from '../shared';
import '../shared/extension';
import { loadLogs } from './loadLogs';
import { Panel } from './panel';
import { regionToSelection } from './regionToSelection';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';
import { update, updateChannelConfigSection } from './update';
import { UriRebaser } from './uriRebaser';

export async function activate(context: ExtensionContext) {
    const disposables = context.subscriptions;
    Store.extensionPath = context.extensionPath;
    Store.globalState = context.globalState;
    disposables.push(commands.registerCommand('sarif.clearState', () => {
        context.globalState.update('view', undefined);
        commands.executeCommand('workbench.action.reloadWindow');
    }));
    const store = new Store();

    // Basing
    const urisNonSarif = await workspace.findFiles('**/*', '.sarif'); // Ignore folders?
    const fileAndUris = urisNonSarif.map(uri => [uri.path.file, uri.toString()]) as [string, string][];
    const baser = new UriRebaser(mapDistinct(fileAndUris), store);

    // Panel
    const panel = new Panel(context, baser, store);
    disposables.push(commands.registerCommand('sarif.showPanel', () => panel.show()));

    // General Activation
    activateDiagnostics(disposables, store, baser);
    activateWatchDocuments(disposables, store, panel);
    activateDecorations(disposables, store, panel);
    activateVirtualDocuments(disposables, store);

    // Check for Updates
    // Borrowed from: https://github.com/Microsoft/vscode-languageserver-node/blob/db0f0f8c06b89923f96a8a5aebc8a4b5bb3018ad/client/src/main.ts#L217
    const isDebugOrTestMode =
        process.execArgv.some(arg => /^--extensionTestsPath=?/.test(arg)) // Debug
        && process.execArgv.some(arg => /^--(debug|debug-brk|inspect|inspect-brk)=?/.test(arg)); // Test
    if (!isDebugOrTestMode) {
        disposables.push(workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration(updateChannelConfigSection)) return;
            update();
        }));
        update();
    }

    // API
    return {
        async openLogs(logs: Uri[], _options: unknown, cancellationToken?: CancellationToken) {
            store.logs.push(...await loadLogs(logs, cancellationToken));
            if (cancellationToken?.isCancellationRequested) return;
            if (store.results.length) panel.show();
        },
        async closeLogs(logs: Uri[]) {
            for (const uri of logs) {
                store.logs.removeFirst(log => log._uri === uri.toString());
            }
        },
        async closeAllLogs() {
            store.logs.splice(0);
        },
        get uriBases() {
            return baser.uriBases.map(uri => Uri.file(uri)) as ReadonlyArray<Uri>;
        },
        set uriBases(values) {
            baser.uriBases = values.map(uri => uri.toString());
        },
    };
}

function activateDiagnostics(disposables: Disposable[], store: Store, baser: UriRebaser) {
    const diagsAll = languages.createDiagnosticCollection('SARIF');
    disposables.push(diagsAll);
    const setDiags = (doc: TextDocument) => {
        // When the user opens a doc, VS Code commonly silently opens the associate `*.git`. We are not interested in these events.
        if (doc.fileName.endsWith('.git')) return;

        const artifactUri = baser.translateLocalToArtifact(doc.uri.toString());
        const severities = {
            error: DiagnosticSeverity.Error,
            warning: DiagnosticSeverity.Warning,
        } as Record<string, DiagnosticSeverity>;
        const diags = store.results
            .filter(result => result._uri === artifactUri)
            .map(result => new ResultDiagnostic(
                regionToSelection(doc, result._region),
                result._message ?? '—',
                severities[result.level ?? ''] ?? DiagnosticSeverity.Information, // note, none, undefined.
                result,
            ));
        diagsAll.set(doc.uri, diags);
    };
    workspace.textDocuments.forEach(setDiags);
    disposables.push(workspace.onDidOpenTextDocument(setDiags));
    disposables.push(workspace.onDidCloseTextDocument(doc => diagsAll.delete(doc.uri))); // Spurious *.git deletes don't hurt.
    const disposer = observe(store.logs, () => workspace.textDocuments.forEach(setDiags));
    disposables.push({ dispose: disposer });
}

// Open Documents <-sync-> Store.logs
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

// Decorations are for Call Trees. This also handles panel selection sync.
function activateDecorations(disposables: Disposable[], store: Store, panel: Panel) {
    const decorationTypeCallout = window.createTextEditorDecorationType({
        after: { color: new ThemeColor('problemsWarningIcon.foreground') }
    });
    const decorationTypeHighlight = window.createTextEditorDecorationType({
        border: '1px',
        borderStyle: 'solid',
        borderColor: new ThemeColor('problemsWarningIcon.foreground'),
    });
    disposables.push(languages.registerCodeActionsProvider('*', {
        provideCodeActions: (doc, _range, context) => {
            if (context.only) return;

            const diagnostic = context.diagnostics[0] as ResultDiagnostic | undefined;
            if (!diagnostic) return;

            const result = diagnostic?.result;
            panel.select(result);
            if (!result) return; // Don't clear the decorations until the next result is selected.

            const editor = window.visibleTextEditors.find(editor => editor.document === doc);
            if (!editor) return; // When would editor be undef?

            const locations = result.codeFlows?.[0]?.threadFlows?.[0]?.locations ?? [];
            const messages = locations.map((tfl, i) => {
                const text = tfl.location?.message?.text;
                return `Step ${i + 1}${text ? `: ${text}` : ''}`;
            });
            const ranges = locations.map(tfl => regionToSelection(doc, parseRegion(tfl.location?.physicalLocation?.region)));
            const rangesEnd = ranges.map(range => {
                const endPos = doc.lineAt(range.end.line).range.end;
                return new Range(endPos, endPos);
            });
            const rangesEndAdj = rangesEnd.map(range => {
                const tabCount = doc.lineAt(range.end.line).text.match(/\t/g)?.length ?? 0;
                const tabCharAdj = tabCount * (editor.options.tabSize as number - 1); // Intra-character tabs are counted wrong.
                return range.end.character + tabCharAdj;
            });
            const maxRangeEnd = Math.max(...rangesEndAdj) + 2; // + for Padding
            const decorCallouts = rangesEnd.map((range, i) => ({
                range,
                hoverMessage: messages[i],
                renderOptions: { after: { contentText: ` ${'┄'.repeat(maxRangeEnd - rangesEndAdj[i])} ${messages[i]}`, } }, // ←
            }));
            editor.setDecorations(decorationTypeCallout, decorCallouts);
            editor.setDecorations(decorationTypeHighlight, ranges);
            return [];
        }
    }));
    const disposer = observe(store.logs, change => {
        const {removed} = change as unknown as IArraySplice<Log>;
        if (!removed.length) return;
        window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(decorationTypeCallout, []);
            editor.setDecorations(decorationTypeHighlight, []);
        });
    });
    disposables.push({ dispose: disposer });
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
                const lines = Buffer.from(contents?.binary, 'base64').toString('hex').match(/.{1,32}/g) ?? [];
                return lines.reduce((sum, line, i) => {
                    const lineNo = ((i + 128) * 16).toString(16).toUpperCase().padStart(8, '0');
                    // eslint-disable-next-line no-control-regex
                    const preview = Buffer.from(line, 'hex').toString('utf8').replace(/(\x09|\x0A|\x0B|\x0C|\x0D|\x1B)/g, '?');
                    return `${sum}${lineNo}  ${line.toUpperCase().match(/.{1,2}/g)?.join(' ')}  ${preview}\n`;
                }, '');
            }
            token.isCancellationRequested = true;
            return '';
        }
    }));
}

export function deactivate() {}
