// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CancellationToken, commands, Disposable, Hover, HoverProvider, languages, MarkdownString, Position, ProviderResult, TextDocument, window } from 'vscode';
import { ResultDiagnostic } from './resultDiagnostic';

export function activateFeedback(disposables: Disposable[]) {
    languages.registerHoverProvider('*', new class implements HoverProvider {
        provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
            const diagnostics = languages.getDiagnostics(document.uri);
            const diagnostic = diagnostics.find(d => d.range.contains(position)) as ResultDiagnostic | undefined;
            const result = diagnostic?.result;
            if (!result) return undefined;

            const feedbackPositive = `command:sarif.feedbackPositive`;
            const feedbackNegative = `command:sarif.feedbackNegative?${encodeURIComponent(JSON.stringify([result._rule?.id]))}`;
            const mds = new MarkdownString(`Was this useful? [$(thumbsup) Yes](${feedbackPositive}) [$(thumbsdown) No](${feedbackNegative})`, true);
            mds.isTrusted = true;
            return new Hover(mds);
        }
    });

    disposables.push(commands.registerCommand('sarif.feedbackPositive', () => {
        window.showInformationMessage('Thank you for your feedback!');
    }));

    disposables.push(commands.registerCommand('sarif.feedbackNegative', async (ruleId: string) => {
        const reason = await window.showQuickPick(
            ['False positive', 'Not actionable', 'Low value', 'Code doesn\'t ship', 'Other'],
            { placeHolder: 'Why was this result not useful?' },
        );
        const comments = await window.showInputBox({ placeHolder: 'Comments (optional)' });
        await window.showInformationMessage(`Reason: ${reason}. Comment: "${comments || ''}". Rule: ${ruleId}. Thank you for your feedback!`);
    }));
}
