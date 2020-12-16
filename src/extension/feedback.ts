// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CancellationToken, commands, Disposable, Hover, HoverProvider, languages, MarkdownString, Position, ProviderResult, Range, TextDocument, window } from 'vscode';
import { ResultId } from '../shared';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';
import { sendFeedback } from './telemetry';

function expandRange(document: TextDocument, range: Range) {
    const startLine = Math.max(range.start.line - 1, 0);
    const endLine = Math.min(range.end.line + 1, document.lineCount - 1)
    return new Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER) // Arbitrarily large number representing the rest of the line.
}

type FeedbackListener = (reason: string, details: Record<string, string>) => void
const feedbackListeners = [] as FeedbackListener[];
export function registerFeedbackListener(listener: FeedbackListener): Disposable {
    feedbackListeners.push(listener);
    return new Disposable(
        () => feedbackListeners.removeFirst(item => item === listener)
    );
}

export function activateFeedback(disposables: Disposable[], store: Store) {
    languages.registerHoverProvider('*', new class implements HoverProvider {
        provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
            const diagnostics = languages.getDiagnostics(document.uri);
            const diagnostic = diagnostics.find(diag => {
                let {range} = diag;
                if (range.isEmpty) {
                    // Accomodating PREfast as it only expresses the range to the beginning of the last token.
                    range = document.getWordRangeAtPosition(range.start) ?? range;
                };
                return range.contains(position)
            }) as ResultDiagnostic | undefined;
            const result = diagnostic?.result;
            if (!result) return undefined;

            const feedback = encodeURIComponent(JSON.stringify([
                result._id,
                document.getText(expandRange(document, diagnostic!.range)),
            ]));
            const feedbackPositive = `command:sarif.feedbackPositive?${feedback}`;
            const feedbackNegative = `command:sarif.feedbackNegative?${feedback}`;
            const mds = new MarkdownString(`Is this result useful? [$(thumbsup) Yes](${feedbackPositive}) [$(thumbsdown) No](${feedbackNegative})`, true);
            mds.isTrusted = true;
            return new Hover(mds);
        }
    });

    const feedbackConfirmationMessage = 'Feedback sent.';
    disposables.push(commands.registerCommand('sarif.feedbackPositive', (resultId: ResultId, _snippet: string) => {
        const [logUri, runIndex, resultIndex] = resultId;
        const result = store.logs.find(log => log._uri === logUri)?.runs[runIndex]?.results?.[resultIndex];
        if (!result) return;

        const feedback = {
            toolName: result._run.tool.driver.name,
            toolVersion: result._run.tool.driver.version ?? '',
            message: result._message,
            ruleId: result._rule?.id ?? '',
        };
        sendFeedback('Helpful', feedback);
        feedbackListeners.forEach(listener => listener('Helpful', feedback));
        window.showInformationMessage(`${feedbackConfirmationMessage} ${JSON.stringify(feedback)}.`);
    }));

    disposables.push(commands.registerCommand('sarif.feedbackNegative', async (resultId: ResultId, snippet: string) => {
        const [logUri, runIndex, resultIndex] = resultId;
        const result = store.logs.find(log => log._uri === logUri)?.runs[runIndex]?.results?.[resultIndex];
        if (!result) return;

        const reason = await window.showQuickPick(
            [
                'False positive',
                'Not actionable',
                'Low value',
                `Code doesn't ship`,
                'Other',
            ],
            { placeHolder: 'Why is this result not useful?' },
        );
        if (reason === undefined) return; // Feedback cancelled.
        
        const shareContextRegion = await window.showQuickPick(
            ['Yes', 'No'],
            { placeHolder: 'Send file snippet?' },
        )
        if (shareContextRegion === undefined) return; // Feedback cancelled.
        if (shareContextRegion === 'No') {
            snippet = '';
        }

        const comments = await window.showInputBox({ placeHolder: 'Comments (optional)' });
        if (comments === undefined) return; // Feedback cancelled.
        
        const feedback = {
            comments,
            toolName: result._run.tool.driver.name,
            toolVersion: result._run.tool.driver.version ?? '',
            message: result._message,
            ruleId: result._rule?.id ?? '',
            snippet,
        };
        sendFeedback(reason, feedback);
        feedbackListeners.forEach(listener => listener('Helpful', feedback));
        await window.showInformationMessage(`${feedbackConfirmationMessage} ${JSON.stringify(feedback)}.`);
    }));
}
