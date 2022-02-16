// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { readFileSync, existsSync, watch } from 'fs';
import fetch from 'node-fetch';
import { Log } from 'sarif';
import { authentication, extensions, workspace } from 'vscode';
import { augmentLog } from '../shared';
import '../shared/extension';
import { GitExtension } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { Store } from './store';

let currentLogUri: string | undefined = undefined;

export function activateGithubAnalyses(store: Store, panel: Panel) {
    const gitExtension = extensions.getExtension<GitExtension>('vscode.git')?.exports;
    if (!gitExtension) return console.warn('No gitExtension');

    const git = gitExtension.getAPI(1);

    // eslint-disable-next-line no-inner-declarations
    async function initialize() {
        const repo = git.repositories[0];
        if (!repo) return console.warn('No repo');

        const origin = await repo.getConfig('remote.origin.url');
        const [, user, repoName] = origin.match(/https:\/\/github.com\/([^/]+)\/([^/]+)\.git/) ?? [];
        if (!user || !repoName) return console.warn('No acceptable origin');

        // procces.cwd() returns '/'
        const workspacePath = workspace.workspaceFolders?.[0]?.uri?.fsPath; // TODO: Multiple workspaces.
        if (!workspacePath) return console.warn('No workspace');
        const gitHeadPath = `${workspacePath}/.git/HEAD`;
        if (!existsSync(gitHeadPath)) return console.warn('No .git/HEAD');

        await update(user, repoName, gitHeadPath);
        watch(`${workspacePath}/.git`, async (_event, filename) => {
            // _event expected to be 'rename'.
            if (filename !== 'HEAD') return;
            await update(user, repoName, gitHeadPath);
        });
    }

    async function update(user: string, repoName: string, gitHeadPath: string) {
        const branchName = await (async () => {
            const branchRef = readFileSync(gitHeadPath, 'utf8');
            if (!branchRef.startsWith('ref: refs/heads/')) return undefined;
            return branchRef.replace('ref: refs/heads/', '');
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

        const log = !analysisId
            ? undefined
            : await (async () => {
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

        if (currentLogUri) {
            store.logs.removeFirst(log => log._uri === currentLogUri);
            currentLogUri = undefined;
        }

        if (log) {
            store.logs.push(log);
            currentLogUri = log._uri;
            if (store.results.length) panel.show();
        }
    }

    // `git` api only used for reading config. Consider reading directly from disk.
    if (git.state !== 'initialized') {
        git.onDidChangeState(async state => {
            if (state === 'initialized') {
                initialize();
            }
        });
    } else {
        initialize();
    }
}
