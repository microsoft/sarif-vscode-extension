// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CancellationToken, commands, Disposable, Hover, HoverProvider, languages, MarkdownString, Position, ProviderResult, Range, TextDocument, window } from 'vscode';
import { ResultDiagnostic } from './resultDiagnostic';
import { sendFeedback } from './telemetry';

function expandRange(document: TextDocument, range: Range) {
    const startLine = Math.max(range.start.line - 1, 0);
    const endLine = Math.min(range.end.line + 1, document.lineCount - 1)
    return new Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER) // Arbitrarily large number representing the rest of the line.
}

export function activateFeedback(disposables: Disposable[]) {
    languages.registerHoverProvider('*', new class implements HoverProvider {
        provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
            const diagnostics = languages.getDiagnostics(document.uri);
            const diagnostic = diagnostics.find(d => d.range.contains(position)) as ResultDiagnostic | undefined;
            const result = diagnostic?.result;
            if (!result) return undefined;

            const textRegion = document.getText(diagnostic!.range);
            const contextRegion = document.getText(expandRange(document, diagnostic!.range));
            const feedbackPositive = `command:sarif.feedbackPositive`;
            const feedbackNegative = `command:sarif.feedbackNegative?${encodeURIComponent(JSON.stringify([result._rule?.id, textRegion, contextRegion]))}`;
            const mds = new MarkdownString(`Is this result useful? [$(thumbsup) Yes](${feedbackPositive}) [$(thumbsdown) No](${feedbackNegative})`, true);
            mds.isTrusted = true;
            return new Hover(mds);
        }
    });

    const feedbackConfirmationMessage = 'Feedback sent.'
    disposables.push(commands.registerCommand('sarif.feedbackPositive', () => {
        sendFeedback('Helpful');
        window.showInformationMessage(feedbackConfirmationMessage);
    }));

    disposables.push(commands.registerCommand('sarif.feedbackNegative', async (ruleId: string, textRegion: string, contextRegion: string) => {
        const reason = await window.showQuickPick(
            ['False positive', 'Not actionable', 'Low value', `Code doesn't ship`, 'Other'],
            { placeHolder: 'Why is this result not useful?' },
        );
        if (reason === undefined) return // Feedback cancelled.
        
        if (reason === 'False positive') {
            const shareContextRegion = await window.showQuickPick(
                ['Yes', 'No'],
                { placeHolder: 'Share context region?' },
            )
            if (shareContextRegion === undefined) return // Feedback cancelled.
            if (shareContextRegion === 'No') {
                textRegion = '';
                contextRegion = '';
            }
        } else {
            textRegion = '';
            contextRegion = '';
        }

        const comments = await window.showInputBox({ placeHolder: 'Comments (optional)' });
        if (comments === undefined) return // Feedback cancelled.
        
        const feedback = { comments, ruleId, textRegion, contextRegion };
        sendFeedback(reason, feedback);
        await window.showInformationMessage(`${feedbackConfirmationMessage} ${JSON.stringify(feedback)}.`);
    }));
}
