// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import fetch from 'node-fetch';
import { Log } from 'sarif';
import { authentication, extensions } from 'vscode';
import { augmentLog } from '../shared';
import '../shared/extension';
import { GitExtension } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { Store } from './store';

export function activateGithubAnalyses(store: Store, panel: Panel) {
    const gitExtension = extensions.getExtension<GitExtension>('vscode.git')?.exports;
    if (!gitExtension) return console.warn('No gitExtension');

    const git = gitExtension.getAPI(1);

    // eslint-disable-next-line no-inner-declarations
    async function fetchAnalysis() {
        const repo = git.repositories[0];
        if (!repo) return console.warn('No repo');

        const origin = await repo.getConfig('remote.origin.url');
        const [, user, repoName] = origin.match(/https:\/\/github.com\/([^/]+)\/([^/]+)\.git/) ?? [];
        if (!user || !repoName) return console.warn('No acceptable origin');

        const branchName = await (async () => {
            const commits = await repo.log({ maxEntries: 1 });
            const hash = commits?.[0]?.hash;
            const branches = await repo.getBranches({ remote: false });
            // optionally bail if no hash...
            return branches.find(branch => branch.commit === hash)?.name;
        })();
        if (!branchName) return console.warn('No branchName');

        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session;
        if (!accessToken) return console.warn('No accessToken');

        const analysisId = await (async () => {
            const analysesResponse = await fetch(`https://api.github.com/repos/${user}/${repoName}/code-scanning/analyses?ref=refs/heads/${branchName}`, {
                headers: {
                    authorization: `Bearer ${accessToken}`,
                },
            });
            const analyses = await analysesResponse.json() as { id: number }[];
            return analyses[0]?.id;
        })();
        if (!analysisId) return console.warn('No analysisId');

        const log = await (async () => {
            const uri = `https://api.github.com/repos/${user}/${repoName}/code-scanning/analyses/${analysisId}`;
            const analysisResponse = await fetch(uri, {
                headers: {
                    accept: 'application/sarif+json',
                    authorization: `Bearer ${accessToken}`,
                },
            });
            const logText = await analysisResponse.text();
            const log = JSON.parse(logText) as Log;
            log._text = logText;
            log._uri = uri;
            augmentLog(log, driverlessRules);
            return log;
        })();

        store.logs.push(log);
        if (store.results.length) panel.show();
    }

    if (git.state !== 'initialized') {
        git.onDidChangeState(async state => {
            if (state === 'initialized') {
                fetchAnalysis();
            }
        });
    } else {
        fetchAnalysis();
    }
}
