// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { diffChars } from 'diff';
import { Fix, Result } from 'sarif';
import { CodeAction, CodeActionKind, Diagnostic, Disposable, languages, OutputChannel, Uri, workspace, WorkspaceEdit } from 'vscode';
import { parseArtifactLocation } from '../shared';
import { getOriginalDoc } from './getOriginalDoc';
import { driftedRegionToSelection } from './regionToSelection';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';
import { UriRebaser } from './uriRebaser';
import { getInitializedGitApi } from './index.activateGithubAnalyses';
import * as path from 'path';
import * as os from 'os';

export function activateFixes(disposables: Disposable[], store: Pick<Store, 'analysisInfo' | 'resultsFixed'>, baser: UriRebaser) {
    disposables.push(languages.registerCodeActionsProvider('*',
        {
            provideCodeActions(_doc, _range, context) {
                // Observed values `context`:
                // context.only          │ context.triggerKind  │ remarks
                // ──────────────────────┼──────────────────────┼────────
                // undefined             │ Automatic=2          │ After document load.           Return all code actions.
                // { value: 'quickFix' } │ Invoke=1             │ Before hover tooltip is shown. Return only specific code actions.

                const diagnostic = context.diagnostics[0] as ResultDiagnostic | undefined;
                if (!diagnostic) return undefined;

                const result = diagnostic?.result;
                if (!result) return undefined;

                return [
                    new ResultQuickFix(diagnostic, result), // Mark as fixed
                    ...result.fixes?.map(fix => new ResultQuickFix(diagnostic, result, fix)) ?? [],
                    ...result.properties?.['github/alertNumber'] === undefined ? [] : [ // Assumes only GitHub will use `github/alertNumber`.
                        new  DismissCodeAction(diagnostic, result, 'sarif.alertDismissFalsePositive', 'False Positive'),
                        new  DismissCodeAction(diagnostic, result, 'sarif.alertDismissUsedInTests', 'Used in Tests'),
                        new  DismissCodeAction(diagnostic, result, 'sarif.alertDismissWontFix', 'Won\'t Fix'),
                    ],
                ];
            },
            async resolveCodeAction(codeAction: ResultQuickFix) {
                const { result, fix, command } = codeAction;

                if (command) return undefined; // VS Code will execute the command on our behalf.

                if (fix) {
                    await applyFix(fix, result, baser, store);
                }

                store.resultsFixed.push(JSON.stringify(result._id));
                return codeAction;
            },
        },
        {
            providedCodeActionKinds: [CodeActionKind.QuickFix]
        },
    ));
}

class ResultQuickFix extends CodeAction {
    constructor(diagnostic: Diagnostic, readonly result: Result, readonly fix?: Fix) {
        // If `fix` then use the `fix.description`
        // If no `fix` then intent is 'Mark as fixed'.
        super(fix ? (fix.description?.text ?? '?') : 'Mark as fixed', CodeActionKind.QuickFix);
        this.diagnostics = [diagnostic]; // Note: VSCode does not use this to clear the diagnostic.
    }
}

class DismissCodeAction extends CodeAction {
    constructor(diagnostic: Diagnostic, result: Result, command: string, reasonText: string) {
        super(`Dismiss - ${reasonText}`, CodeActionKind.Empty);
        this.diagnostics = [diagnostic]; // Note: VSCode does not use this to clear the diagnostic.
        this.command = {
            title: '', // Leaving empty as it is seemingly not used (yet required).
            command,
            arguments: [{ resultId: JSON.stringify(result._id) }],
        };
    }
}

export async function applyFix(fix: Fix, result: Result, baser: UriRebaser, store: Pick<Store, 'analysisInfo'>, outputChannel?: OutputChannel) {
    // Some fixes are injected as raw diffs. If so, apply them directly.
    const diff = fix.properties?.diff;
    if (diff) {
        outputChannel?.appendLine('diff found:');
        outputChannel?.appendLine('--------');
        outputChannel?.appendLine(diff);
        outputChannel?.appendLine('--------');
        const git = await getInitializedGitApi();
        if (!git) {
            throw new Error('Unable to initialize Git API.');
        }
        // save diff to a temp file
        const filePath = path.join(os.tmpdir(), `${(new Date()).getTime()}.patch`);
        try {
            await workspace.fs.writeFile(Uri.parse(filePath), Buffer.from(diff, 'utf-8'));
            // TODO assume exactly one repository, which will usually be the case for codespaces.
            // All the situations we need to handle right now are single repository.
            await git?.repositories[0].apply(filePath);
            outputChannel?.appendLine('diff applied.');
        } finally {
            await workspace.fs.delete(Uri.parse(filePath));
        }
        return;
    }
    outputChannel?.appendLine('Edit found.');
    const edit = new WorkspaceEdit();
    for (const artifactChange of fix.artifactChanges) {
        const [uri, uriBase] = parseArtifactLocation(result, artifactChange.artifactLocation);
        const artifactUri = uri;
        if (!artifactUri) continue;

        const localUri = await baser.translateArtifactToLocal(artifactUri, uriBase);
        if (!localUri) continue;
        outputChannel?.appendLine(`Applying fix to ${localUri.toString()}`);

        const currentDoc = await workspace.openTextDocument(localUri);
        const originalDoc = await getOriginalDoc(store.analysisInfo?.commit_sha, currentDoc);
        const diffBlocks = originalDoc ? diffChars(originalDoc.getText(), currentDoc.getText()) : [];

        for (const replacement of artifactChange.replacements) {
            edit.replace(
                localUri,
                driftedRegionToSelection(diffBlocks, currentDoc, replacement.deletedRegion, originalDoc),
                replacement.insertedContent?.text ?? '',
            );
        }
    }
    workspace.applyEdit(edit);
}
