// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { watch } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { runInAction } from 'mobx';
import fetch from 'node-fetch';
import { Log } from 'sarif';
import { authentication, Disposable, extensions, workspace } from 'vscode';
import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { augmentLog } from '../shared';
import '../shared/extension';
import { API, GitExtension, Repository } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { Store } from './store';

const defaultStatusText = '$(shield) Sarif';
const spinningStatusText = '$(sync~spin) Sarif';
let statusBarItem: StatusBarItem;
let currentLogUri: string | undefined = undefined;

export async function getInitializedGitApi(): Promise<API | undefined> {
    return new Promise(resolve => {
        const gitExtension = extensions.getExtension<GitExtension>('vscode.git')?.exports;
        if (!gitExtension) {
            resolve(undefined);
            return;
        }

        const git = gitExtension.getAPI(1);
        if (git.state !== 'initialized') {
            git.onDidChangeState(async state => {
                if (state === 'initialized') {
                    resolve(git);
                }
            });
        } else {
            resolve(git);
        }
    });
}

export function activateGithubAnalyses(disposables: Disposable[], store: Store, panel: Panel) {
    const config = {
        user: '',
        repoName: '',
    };

    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    disposables.push(statusBarItem);
    statusBarItem.text = defaultStatusText;
    statusBarItem.command = 'sarif.showPanel';
    statusBarItem.tooltip ='Show SARIF Panel';
    statusBarItem.show();

    (async () => {
        const git = await getInitializedGitApi();
        if (!git) return console.warn('No GitExtension or GitExtension API');

        const repo = git.repositories[0];
        if (!repo) return console.warn('No repo');

        const origin = await repo.getConfig('remote.origin.url');
        const [, user, repoName] = origin.match(/https:\/\/github.com\/([^/]+)\/([^/]+)/) ?? [];
        if (!user || !repoName) return console.warn('No acceptable origin');
        config.user = user;
        config.repoName = repoName.replace('.git', ''); // A repoName may optionally end with '.git'. Normalize it out.

        // procces.cwd() returns '/'
        const workspacePath = workspace.workspaceFolders?.[0]?.uri?.fsPath; // TODO: Multiple workspaces.
        if (!workspacePath) return console.warn('No workspace');
        const gitHeadPath = `${workspacePath}/.git/HEAD`;
        if (!existsSync(gitHeadPath)) return console.warn('No .git/HEAD');

        await onGitChanged(repo, gitHeadPath, store);
        const watcher = watch([
            `${workspacePath}/.git/refs/heads`, // TODO: Only watch specific branch.
        ], { ignoreInitial: true });
        watcher.on('all', (/* examples: eventName = change, path = .git/refs/heads/demo */) => {
            onGitChanged(repo, gitHeadPath, store);
        });
    })();

    async function onGitChanged(repo: Repository, gitHeadPath: string, store: Store) {
        // Get current branch. No better way:
        // * repo.log does not show branch info
        // * repo.getBranch('') returns the alphabetical first
        // * repo.getBranches({ remote: true }) doesn't show which is the current
        // TODO: Guard against !branchRef.startsWith('ref: refs/heads/')
        const branchRef = readFileSync(gitHeadPath, 'utf8').replace('ref: ', '').trim(); // example: refs/heads/demo
        const branchName = branchRef.replace('refs/heads/', '');
        const commitLocal = await repo.getCommit(branchRef);

        runInAction(() => {
            store.branch = branchName;
            store.commitHash = commitLocal.hash;
        });

        const analysisId = await pollerRepeatAction();
        await pollerFinalAction(analysisId);
    }


    async function pollerRepeatAction(): Promise<number | undefined> {
        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session;
        if (!accessToken) {
            store.banner = 'Unable to authenticate.';
            return undefined;
        }

        const branchName = store.branch;
        const analysesResponse = await fetch(`https://api.github.com/repos/${config.user}/${config.repoName}/code-scanning/analyses?ref=refs/heads/${branchName}`, {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });
        if (analysesResponse.status === 403) {
            store.banner = 'GitHub Advanced Security is not enabled for this repository.';
            return undefined;
        }
        const analyses = await analysesResponse.json() as { id: number, commit_sha: string, created_at: string }[];

        // Possibilities:
        // a) analysis is not enabled for repo or branch.
        // b) analysis is enabled, but pending.
        if (!analyses.length) {
            return undefined;
        }

        // Find the intersection.
        const git = await getInitializedGitApi();
        if (!git) return undefined; // No GitExtension or GitExtension API.

        const repo = git.repositories[0];
        const commits = await repo.log({});
        const intersectingAnalysis = analyses.find(analysis => {
            return commits.some(commit => analysis.commit_sha === commit.hash);
        });

        // Possibilities:
        // a) the intersection is outside of the page size
        // b) other?
        if (!intersectingAnalysis) {
            return undefined; // Might need to return true. TODO: Think about what this means.
        }

        store.intersectingHash = intersectingAnalysis.commit_sha;
        store.intersectingDate = new Date(intersectingAnalysis.created_at);
        store.intersectingCommitsAgo = commits.findIndex(commit => commit.hash === intersectingAnalysis.commit_sha);
        return intersectingAnalysis.id;
    }

    async function pollerFinalAction(analysisId: number | undefined): Promise<void> {
        statusBarItem.text = spinningStatusText;

        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session; // Assume non-null as we already called it recently.

        const log = !analysisId
            ? undefined
            : await (async () => {
                const uri = `https://api.github.com/repos/${config.user}/${config.repoName}/code-scanning/analyses/${analysisId}`;
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

            const messageWarnStale = store.intersectingHash !== store.commitHash
                ? ` The most recent scan was ${store.intersectingCommitsAgo} commit(s) ago` +
                  ` on ${store.intersectingDate.toLocaleString()}.` +
                  ` Refresh to check for more current results.`
                : '';

            store.banner = `Results updated for current commit ${store.commitHash.slice(0, 7)}.` + messageWarnStale;
        } else {
            store.banner = '';
        }

        panel.show();
        statusBarItem.text = defaultStatusText;
    }
}
