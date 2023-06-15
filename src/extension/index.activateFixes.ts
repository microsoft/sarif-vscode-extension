// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { diffChars } from 'diff';
import { Fix, Result } from 'sarif';
import { CodeAction, CodeActionKind, Diagnostic, Disposable, languages, Uri, workspace, WorkspaceEdit } from 'vscode';
import { parseArtifactLocation } from '../shared';
import { getOriginalDoc } from './getOriginalDoc';
import { driftedRegionToSelection } from './regionToSelection';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';
import { UriRebaser } from './uriRebaser';

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
                    const edit = new WorkspaceEdit();
                    for (const artifactChange of fix.artifactChanges) {
                        const [uri, _uriContents] = parseArtifactLocation(result, artifactChange.artifactLocation);
                        const artifactUri = uri;
                        if (!artifactUri) continue;

                        const localUri = await baser.translateArtifactToLocal(artifactUri);
                        const currentDoc = await workspace.openTextDocument(Uri.parse(localUri, true /* Why true? */));
                        const originalDoc = await getOriginalDoc(store.analysisInfo?.commit_sha, currentDoc);
                        const diffBlocks = originalDoc ? diffChars(originalDoc.getText(), currentDoc.getText()) : [];

                        for (const replacement of artifactChange.replacements) {
                            edit.replace(
                                Uri.parse(localUri),
                                driftedRegionToSelection(diffBlocks, currentDoc, replacement.deletedRegion, originalDoc),
                                replacement.insertedContent?.text ?? '',
                            );
                        }
                    }
                    workspace.applyEdit(edit);
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
