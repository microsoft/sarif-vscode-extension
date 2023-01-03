// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import fetch, { FetchError } from 'node-fetch';
import { authentication } from 'vscode';
import { outputChannel } from './outputChannel';

type LogInfo = { analysisId: number, uri: string, text: string };

// Subset of the GitHub API.
export interface AnalysisInfo {
    id: number;
    commit_sha: string;
    created_at: string;
    tool: { name: string };
    results_count: number;
}

export class AnalysisProviderGithub {
    constructor(readonly user: string, readonly repoName: string) {}

    async fetchAnalysisInfos(
        branch: string,
        updateMessage: (message: string) => void)
        : Promise<AnalysisInfo[] | undefined> {

        try {
            updateMessage('Checking GitHub Advanced Security...');

            // STEP 1: Auth
            const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
            const { accessToken } = session;
            if (!accessToken) {
                updateMessage('Unable to authenticate.');
                return undefined;
            }

            // STEP 2: Fetch
            // Useful for debugging the progress indicator: await new Promise(resolve => setTimeout(resolve, 2000));
            const analysesResponse = await fetch(`https://api.github.com/repos/${this.user}/${this.repoName}/code-scanning/analyses?ref=refs/heads/${branch}`, {
                headers: {
                    authorization: `Bearer ${accessToken}`,
                },
            });

            if (analysesResponse.status === 403) {
                updateMessage('GitHub Advanced Security is not enabled for this repository.');
                return undefined;
            }

            // STEP 3: Parse
            const anyResponse = await analysesResponse.json();
            if (anyResponse.message) {
                // Sample message response:
                // {
                //     "message": "You are not authorized to read code scanning alerts.",
                //     "documentation_url": "https://docs.github.com/rest/reference/code-scanning#list-code-scanning-analyses-for-a-repository"
                // }
                const messageResponse = anyResponse as { message: string, documentation_url: string };
                updateMessage(messageResponse.message);
                return undefined;
            }

            const analyses = anyResponse as AnalysisInfo[];

            // Possibilities:
            // a) analysis is not enabled for repo or branch.
            // b) analysis is enabled, but pending first-ever run.
            if (!analyses.length) {
                updateMessage('Refresh to check for more current results.');
                return undefined;
            }
            const analysesString = analyses.map(({ created_at, commit_sha, id, tool, results_count }) => `${created_at} ${commit_sha} ${id} ${tool.name} ${results_count}`).join('\n');
            outputChannel.appendLine(`Analyses:\n${analysesString}\n`);

            return analyses;
        } catch (error) {
            if (error instanceof FetchError) {
                // Expected if the network is disabled.
                // error.name: FetchError
                // error.message: request to https://api.github.com/repos/microsoft/sarif-vscode-extension/code-scanning/analyses?ref=refs/heads/main failed, reason: getaddrinfo ENOTFOUND api.github.com
                updateMessage('Network error. Refresh to try again.');
            }
            return undefined;
        }
    }

    async fetchAnalysis(analysisInfoIds: number[]): Promise<LogInfo[]> {
        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session; // Assume non-null as we already called it recently.

        const logTexts = [] as LogInfo[];
        for (const analysisId of analysisInfoIds) {
            const uri = `https://api.github.com/repos/${this.user}/${this.repoName}/code-scanning/analyses/${analysisId}`;
            const analysisResponse = await fetch(uri, {
                headers: {
                    accept: 'application/sarif+json',
                    authorization: `Bearer ${accessToken}`,
                },
            });
            logTexts.push({
                analysisId,
                uri,
                text: await analysisResponse.text(),
            });
        }
        return logTexts;
    }
}
