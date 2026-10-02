// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import fetch, { Response } from 'node-fetch';
import { authentication, commands, Disposable, OutputChannel, window } from 'vscode';
import { findResult, ResultId } from '../shared';
import { Store } from './store';

// As defined by https://docs.github.com/en/rest/code-scanning#update-a-code-scanning-alert
type DismissedReason = 'false positive' | 'won\'t fix' | 'used in tests'
type GithubAlertResponse = {
    state?: string;
    message?: string;
}

const dismissedCommentMaxLength = 280;

export function activateGithubCommands(disposables: Disposable[], store: Store, outputChannel: OutputChannel) {
    // Unfortunately, `resultId` is wrapped with a `context` object as a result of how VS Code Webview context menus work.
    async function dismissAlert(context: { resultId: string }, reason: DismissedReason) {
        const { resultId } = context;
        const result = findResult(store.logs, JSON.parse(resultId) as ResultId);
        if (!result) return;

        const logUri = result._log._uri; // Sample: https://api.github.com/repos/microsoft/binskim/code-scanning/analyses/46889472
        const alertNumber = result.properties?.['github/alertNumber'];
        if (!logUri || typeof alertNumber !== 'number') return;

        const [, ownerAndRepo] = logUri.match(/https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+\/code-scanning)\/analyses\/\d+/) ?? [];
        if (!ownerAndRepo) return;

        const dismissedComment = await window.showInputBox({
            ignoreFocusOut: true,
            prompt: 'Provide a comment for this code scanning alert dismissal',
            validateInput: value => {
                if (!value.trim()) return 'A dismissal comment is required.';
                if (value.length > dismissedCommentMaxLength) return `Dismissal comments cannot exceed ${dismissedCommentMaxLength} characters.`;
                return undefined;
            },
        });
        if (dismissedComment === undefined) return;

        // API: https://docs.github.com/en/rest/code-scanning#update-a-code-scanning-alert
        // Sample: https://api.github.com/repos/microsoft/binskim/code-scanning/alerts/74
        const response = await callGithubRepos(`${ownerAndRepo}/alerts/${alertNumber}`, {
            state: 'dismissed',
            dismissed_reason: reason,
            dismissed_comment: dismissedComment.trim(),
            create_request: true,
        });

        if (!response) {
            const message = `Unable to dismiss code scanning alert ${alertNumber}: No response from GitHub.`;
            outputChannel.appendLine(message);
            await window.showErrorMessage(message);
            return;
        }

        let json = {} as GithubAlertResponse;
        try {
            json = await response.json() as GithubAlertResponse;
        } catch {
            // Use statusText below when GitHub or a proxy returns an empty or non-JSON response.
        }
        if (response.status === 200 && json.state === 'dismissed') {
            store.resultsFixed.push(resultId);
            await window.showInformationMessage(`Code scanning alert ${alertNumber} dismissed.`);
            return;
        }

        if (response.status === 200 && json.state === 'open') {
            await window.showInformationMessage(`Dismissal request created for code scanning alert ${alertNumber}.`);
            return;
        }

        const message = `Unable to dismiss code scanning alert ${alertNumber}: ${json.message ?? response.statusText}`;
        outputChannel.appendLine(`Status ${response.status} - ${message}`);
        await window.showErrorMessage(message);
    }

    disposables.push(
        commands.registerCommand('sarif.alertDismissFalsePositive', async (context) => dismissAlert(context, 'false positive')),
        commands.registerCommand('sarif.alertDismissUsedInTests',   async (context) => dismissAlert(context, 'used in tests')),
        commands.registerCommand('sarif.alertDismissWontFix',       async (context) => dismissAlert(context, 'won\'t fix')),
    );
}

// `api` does not include leading slash.
async function callGithubRepos(api: string, body: Record<string, string | boolean> | undefined): Promise<Response | undefined> {
    const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
    const { accessToken } = session;
    if (!accessToken) return undefined;

    try {
        // Useful for debugging the progress indicator: await new Promise(resolve => setTimeout(resolve, 2000));
        return await fetch(`https://api.github.com/repos/${api}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            method: 'PATCH',
            body: body && JSON.stringify(body),
        });
    } catch (error) {
        // Future: Pipe `error` to OutputChannel. Need to make OutputChannel exportable.
        return undefined;
    }
}
