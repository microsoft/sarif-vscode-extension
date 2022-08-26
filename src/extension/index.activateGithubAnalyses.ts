// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { watch } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { observe } from 'mobx';
import fetch from 'node-fetch';
import { Log } from 'sarif';
import { authentication, extensions, workspace } from 'vscode';
import { augmentLog } from '../shared';
import '../shared/extension';
import { API, GitExtension, Repository } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { isSpinning } from './statusBarItem';
import { Store } from './store';

// Subset of the GitHub API.
export interface AnalysisInfo {
    id: number;
    commit_sha: string;
    created_at: string;
    commitsAgo: number; // Not part of the API. We added this.
}

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

export function activateGithubAnalyses(store: Store, panel: Panel) {
    const config = {
        user: '',
        repoName: '',
    };

    // TODO: Block re-entrancy.
    observe(store, 'remoteAnalysisInfoUdpated', () => updateAnalysisInfo());

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

        // At this point all the local requirements have been satisfied.
        // We preemptively show the panel (even before the result as fetched)
        // so that the banner is visible.
        await panel.show();

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

        store.branch = branchName;
        store.commitHash = commitLocal.hash;
        await updateAnalysisInfo();
    }

    async function updateAnalysisInfo(): Promise<void> {
        store.banner = 'Checking GitHub Advanced Security...';

        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session;
        if (!accessToken) {
            store.banner = 'Unable to authenticate.';
            store.analysisInfo = undefined;
        }

        const branchName = store.branch;
        const analysesResponse = await fetch(`https://api.github.com/repos/${config.user}/${config.repoName}/code-scanning/analyses?ref=refs/heads/${branchName}`, {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });
        if (analysesResponse.status === 403) {
            store.banner = 'GitHub Advanced Security is not enabled for this repository.';
            store.analysisInfo = undefined;
        }

        const anyResponse = await analysesResponse.json();
        if (anyResponse.message) {
            // Sample message response:
            // {
            //     "message": "You are not authorized to read code scanning alerts.",
            //     "documentation_url": "https://docs.github.com/rest/reference/code-scanning#list-code-scanning-analyses-for-a-repository"
            // }
            const messageResponse = anyResponse as { message: string, documentation_url: string };
            store.banner = messageResponse.message;
            store.analysisInfo = undefined;
            return;
        }

        const analyses = anyResponse as AnalysisInfo[];

        // Possibilities:
        // a) analysis is not enabled for repo or branch.
        // b) analysis is enabled, but pending first-ever run.
        if (!analyses.length) {
            store.banner = 'Refresh to check for more current results.';
            store.analysisInfo = undefined;
        }

        // Find the intersection.
        const git = await getInitializedGitApi();
        if (!git) return undefined; // No GitExtension or GitExtension API.

        const repo = git.repositories[0];
        const commits = await repo.log({});
        const analysisInfo = analyses.find(analysis => {
            return commits.some(commit => analysis.commit_sha === commit.hash);
        });

        // If `analysisInfo` is undefined at this point, then...
        // a) the intersection is outside of the page size
        // b) other?
        if (analysisInfo) {
            const commitsAgo = commits.findIndex(commit => commit.hash === analysisInfo.commit_sha);
            analysisInfo.commitsAgo = commitsAgo;
        } else {
            store.banner = '';
        }

        if (store.analysisInfo?.id !== analysisInfo?.id) {
            store.analysisInfo = analysisInfo;
        } else {
            setBannerResultsUpdated(analysisInfo, 'unchanged');
        }
    }

    async function fetchAnalysis(analysisInfo: AnalysisInfo | undefined): Promise<void> {
        isSpinning.set(true);

        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session; // Assume non-null as we already called it recently.

        const log = !analysisInfo?.id
            ? undefined
            : await (async () => {
                const uri = `https://api.github.com/repos/${config.user}/${config.repoName}/code-scanning/analyses/${analysisInfo.id}`;
                const analysisResponse = await fetch(uri, {
                    headers: {
                        accept: 'application/sarif+json',
                        authorization: `Bearer ${accessToken}`,
                    },
                });
                const logText = await analysisResponse.text();
                const log = JSON.parse(logText) as Log;
                (await import('fs')).writeFileSync(`/Volumes/Jeff/projects/sarif-vscode-extension/ignore/sarif-testing/${analysisInfo.id}.sarif`, logText);
                log._text = logText;
                log._uri = uri;
                const primaryWorkspaceFolderUriString = workspace.workspaceFolders?.[0]?.uri.toString();
                augmentLog(log, driverlessRules, primaryWorkspaceFolderUriString);
                return log;
            })();

        if (currentLogUri) {
            store.logs.removeFirst(log => log._uri === currentLogUri);
            currentLogUri = undefined;
        }

        if (log) {
            store.logs.push(log);
            currentLogUri = log._uri;
        }

        panel.show();
        isSpinning.set(false);

        setBannerResultsUpdated(analysisInfo);
    }

    function setBannerResultsUpdated(analysisInfo: AnalysisInfo | undefined, verb: 'updated' | 'unchanged' = 'updated') {
        if (!analysisInfo) return;

        const messageWarnStale = analysisInfo.commit_sha !== store.commitHash
            ? ` The most recent scan was ${analysisInfo.commitsAgo} commit(s) ago` +
            ` on ${new Date(analysisInfo.created_at).toLocaleString()}.` +
            ` Refresh to check for more current results.`
            : '';
        store.banner = `Results ${verb} for current commit ${store.commitHash.slice(0, 7)}.` + messageWarnStale;
    }

    observe(store, 'analysisInfo', () => fetchAnalysis(store.analysisInfo));
}
