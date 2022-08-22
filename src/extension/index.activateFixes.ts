// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { Result } from 'sarif';
import { CodeAction, CodeActionKind, Disposable, languages } from 'vscode';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';

export function activateFixes(disposables: Disposable[], store: Pick<Store, 'resultsFixed'>) {
    disposables.push(languages.registerCodeActionsProvider('*',
        {
            provideCodeActions(_doc, _range, context) {
                // Observed values `context`:
                // context.only          │ context.triggerKind  │ remarks
                // ──────────────────────┼──────────────────────┼────────
                // undefined             │ Automatic=2          │ After document load.           Return all code actions.
                // { value: 'quickFix' } │ Invoke=1             │ Before hover tooltip is shown. Return only specific code actions.

                const diagnostic = context.diagnostics[0] as ResultDiagnostic | undefined;
                if (!diagnostic) return;

                const result = diagnostic?.result;
                if (!result) [];

                const quickFixes = [];
                {
                    const markAsFixed = new ResultQuickFix('Mark as fixed', result);
                    markAsFixed.diagnostics = [diagnostic]; // Note: VSCode does not use this to clear the diagnostic.
                    quickFixes.push(markAsFixed);
                }

                return quickFixes;
            },
            resolveCodeAction(codeAction: ResultQuickFix) {
                const result = codeAction.result;
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
    constructor(title: string, readonly result: Result) {
        super(title, CodeActionKind.QuickFix);
    }
}
