// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import assert from 'assert';
import { observable } from 'mobx';
import { FetchError } from 'node-fetch';
import proxyquire from 'proxyquire';
import { ReportingDescriptor } from 'sarif';
import { Store } from './store';

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
                                    log: () => gitLog.map(hash => ({ hash })),
                                },
                            ],
                        }),
                    },
                }),
            },
        },
        './loadLogs': {
            driverlessRules: new Map<string, ReportingDescriptor>(),
        },
        './statusBarItem': {
            isSpinning: observable.box(false),
        },
        './telemetry': {
            sendGithubConfig: () => {},
            sendGithubEligibility: () => {},
            sendGithubPromptChoice: () => {},
            sendGithubAnalysisFound: () => {},
        },
    });
}

describe('fetchAnalysisInfos', () => {
    it('handles GHAS not enabled', async () => {
        const { fetchAnalysisInfos } = proxyquireActivateGithubAnalyses(403);

        let lastMessage = '';
        const info = await fetchAnalysisInfos('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'GitHub Advanced Security is not enabled for this repository.');
        assert.strictEqual(info, undefined);
    });

    it('handles GHAS message', async () => {
        const { fetchAnalysisInfos } = proxyquireActivateGithubAnalyses({ message: 'You are not authorized to read code scanning alerts.' });

        let lastMessage = '';
        const info = await fetchAnalysisInfos('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'You are not authorized to read code scanning alerts.');
        assert.strictEqual(info, undefined);
    });

    it('handles analyses.length zero', async () => {
        const { fetchAnalysisInfos } = proxyquireActivateGithubAnalyses([]);

        let lastMessage = '';
        const info = await fetchAnalysisInfos('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'Refresh to check for more current results.');
        assert.strictEqual(info, undefined);
    });

    it('handles no intersecting commit', async () => {
        const { fetchAnalysisInfos } = proxyquireActivateGithubAnalyses(
            [ analysisInfoCodeQL1 ],
            ['f1f734698cd27d602d45a49cc8b755cc19b5ca1c'],
        );

        let lastMessage = '';
        const info = await fetchAnalysisInfos('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'No intersecting commit.');
        assert.strictEqual(info, undefined);
    });

    it('handles no duplicate tools (also the common case)', async () => {
        const { fetchAnalysisInfos } = proxyquireActivateGithubAnalyses(
            [ analysisInfoCodeQL1, analysisInfoCodeQL2, analysisInfoESLint1, analysisInfoESLint2 ],
            ['f1f734698cd27d602d45a49cc8b755cc19b5ca1c', '7bd21f58079a6b35ccdba51a491f2362c204a165'],
        );

        let lastMessage = '';
        const info = await fetchAnalysisInfos('owner', 'repo', 'main', (message: string) => lastMessage = message);
        assert.strictEqual(lastMessage, 'Checking GitHub Advanced Security...');
        assert.strictEqual(info.ids.length, 2);
    });
});

describe('interceptStore', () => {
    const analysisInfo = {
        'ids': [
            54017899,
            51696264,
        ],
        'commit_sha': '7bd21f58079a6b35ccdba51a491f2362c204a165',
        'created_at': '2022-12-02T11:43:59Z',
        'commitsAgo': 0,
    };

    it('Reports updated', async () => {
        const store = new Store();
        const { interceptAnalysisInfo } = proxyquireActivateGithubAnalyses(403);
        interceptAnalysisInfo(store);
        store.analysisInfos = analysisInfo;
        assert.strictEqual(store.banner, 'Updating...');
    });

    it('Reports unchanged', async () => {
        const store = new Store();
        const { interceptAnalysisInfo } = proxyquireActivateGithubAnalyses(403);
        interceptAnalysisInfo(store);
        store.analysisInfos = analysisInfo;
        store.analysisInfos = analysisInfo;
        assert.strictEqual(store.banner, 'Results unchanged for current commit . The most recent scan was 0 commit(s) ago on 12/2/2022, 3:43:59 AM. Refresh to check for more current results.');
    });

    it('Reports not scanned', async () => {
        const store = new Store();
        const { interceptAnalysisInfo } = proxyquireActivateGithubAnalyses(403);
        interceptAnalysisInfo(store);
        store.analysisInfos = undefined;
        assert.strictEqual(store.banner, 'This branch has not been scanned.');
    });
});
