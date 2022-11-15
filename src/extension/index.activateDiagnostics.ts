// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { diffChars } from 'diff';
import { observe } from 'mobx';
import { DiagnosticSeverity, Disposable, languages, OutputChannel, TextDocument, workspace } from 'vscode';
import '../shared/extension';
import { getOriginalDoc } from './getOriginalDoc';
import { driftedRegionToSelection } from './regionToSelection';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';
import { UriRebaser } from './uriRebaser';

export function activateDiagnostics(disposables: Disposable[], store: Store, baser: UriRebaser, outputChannel: OutputChannel) {
    const diagsAll = languages.createDiagnosticCollection('SARIF');
    disposables.push(diagsAll);
    const setDiags = async (doc: TextDocument) => {
        // When the user opens a doc, VS Code commonly silently opens the associate `*.git`. We are not interested in these events.
        if (doc.fileName.endsWith('.git')) return;
        if (doc.uri.scheme === 'output') return; // Example "output:extension-output-MS-SarifVSCode.sarif-viewer-%231-Sarif%20Viewer"
        if (doc.uri.scheme === 'vscode') return; // Example "vscode:scm/git/scm0/input?rootUri..."

        const localUri = await (async () => {
            if (doc.uri.scheme === 'sarif') {
                return doc.uri.toString();
            }
            return await baser.translateLocalToArtifact(doc.uri.toString());
        })();
        const severities = {
            error: DiagnosticSeverity.Error,
            warning: DiagnosticSeverity.Warning,
        } as Record<string, DiagnosticSeverity>;
        const matchingResults = store.results
            .filter(result => {
                const artifactUri = result._uriContents ?? result._uri;
                return artifactUri === localUri;
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
