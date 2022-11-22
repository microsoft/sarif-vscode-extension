// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import assert from 'assert';
import { FetchError } from 'node-fetch';
import proxyquire from 'proxyquire';

proxyquire.noCallThru();

const commit_sha = '7bd21f58079a6b35ccdba51a491f2362c204a165';
const created_at = '2022-11-17T00:41:14Z';
const analysisInfoCodeQL1 = { id: 0, tool: { name: 'CodeQL' }, commit_sha, created_at };
const analysisInfoCodeQL2 = { id: 1, tool: { name: 'CodeQL' }, commit_sha, created_at };
const analysisInfoESLint1 = { id: 2, tool: { name: 'ESLint' }, commit_sha, created_at };
const analysisInfoESLint2 = { id: 3, tool: { name: 'ESLint' }, commit_sha, created_at };

const workspaceUri = '';
function proxyquireActivateGithubAnalyses(mockFetchResult: number | unknown, gitLog: string[] = []) {
    return proxyquire('./index.activateGithubAnalyses', {
        'node-fetch': (() => {
            const nodeFetch = async (/* url: string */) => {
                if (typeof mockFetchResult === 'number') {
                    return { status: mockFetchResult };
                }
                return {
                    status: 200,
                    json: async () => mockFetchResult,
                };
            };
            nodeFetch.FetchError = FetchError;
            return nodeFetch;
        })(),
        'vscode': {
            '@global': true,
            '@noCallThru': true,
            authentication: {
                getSession: () => ({ accessToken: 'anyValue' }),
            },
            workspace: {
                workspaceFolders: [{ uri: workspaceUri }],
            },
            extensions: {
                getExtension: (/* 'vscode.git' */) => ({
                    exports: {
                        getAPI: (/* 1 */) => ({
                            state: 'initialized',
                            repositories: [
                                {
                                    rootUri: workspaceUri,
                                    log: () => gitLog.map(hash => ({ hash }))
                                }
                            ]
                        })
                    }
                }),
            }
        }
    });
}

describe('fetchAnalysisInfo', () => {
    it('handles GHAS not enabled', async () => {
        const { fetchAnalysisInfo } = proxyquireActivateGithubAnalyses(403);

        let lastMessage = '';
        const info = await fetchAnalysisInfo('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'GitHub Advanced Security is not enabled for this repository.');
        assert.strictEqual(info, undefined);
    });

    it('handles GHAS message', async () => {
        const { fetchAnalysisInfo } = proxyquireActivateGithubAnalyses({ message: 'You are not authorized to read code scanning alerts.' });

        let lastMessage = '';
        const info = await fetchAnalysisInfo('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'You are not authorized to read code scanning alerts.');
        assert.strictEqual(info, undefined);
    });

    it('handles analyses.length zero', async () => {
        const { fetchAnalysisInfo } = proxyquireActivateGithubAnalyses([]);

        let lastMessage = '';
        const info = await fetchAnalysisInfo('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'Refresh to check for more current results.');
        assert.strictEqual(info, undefined);
    });

    it('handles no intersecting commit', async () => {
        const { fetchAnalysisInfo } = proxyquireActivateGithubAnalyses(
            [ analysisInfoCodeQL1 ],
            ['f1f734698cd27d602d45a49cc8b755cc19b5ca1c'],
        );

        let lastMessage = '';
        const info = await fetchAnalysisInfo('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'No intersecting commit.');
        assert.strictEqual(info, undefined);
    });

    it('handles no duplicate tools (also the common case)', async () => {
        const { fetchAnalysisInfo } = proxyquireActivateGithubAnalyses(
            [ analysisInfoCodeQL1, analysisInfoCodeQL2, analysisInfoESLint1, analysisInfoESLint2 ],
            ['f1f734698cd27d602d45a49cc8b755cc19b5ca1c', '7bd21f58079a6b35ccdba51a491f2362c204a165'],
        );

        let lastMessage = '';
        const info = await fetchAnalysisInfo('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'Checking GitHub Advanced Security...');
        assert.strictEqual(info.ids.length, 2);
    });
});
