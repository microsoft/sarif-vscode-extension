// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { watch } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { autorun } from 'mobx';
import fetch from 'node-fetch';
import { Log } from 'sarif';
import { authentication, Disposable, extensions, workspace } from 'vscode';
import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { augmentLog } from '../shared';
import '../shared/extension';
import { GitExtension, Repository } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { Poller } from './poller';
import { Store } from './store';

const defaultStatusText = '$(shield) SARIF';
let statusBarItem: StatusBarItem;
let currentLogUri: string | undefined = undefined;

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

    const poller = new Poller(pollerRepeatAction, pollerFinalAction, 30001);

    autorun(() => {
        const branch = store.branch;
        const branchRel = branch.slice(-1);

        // Fine tune branch changes
        if (branchRel === '+') { // local is a head and origin does not have analyses to provide
            poller.stop();
        } else { // = or - means origin has analyses to provide
            poller.start();
        }
    });

    const gitExtension = extensions.getExtension<GitExtension>('vscode.git')?.exports;
    if (!gitExtension) return console.warn('No gitExtension');

    const git = gitExtension.getAPI(1);

    if (git.state !== 'initialized') {
        git.onDidChangeState(async state => {
            if (state === 'initialized') {
                initialize();
            }
        });
    } else {
        initialize();
    }

    // eslint-disable-next-line no-inner-declarations
    async function initialize() {
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
            `${workspacePath}/.git/HEAD`,
            `${workspacePath}/.git/refs`,
        ], { ignoreInitial: true });
        watcher.on('all', () => {
            // args: event = change, path = .git/refs/heads/demo
            onGitChanged(repo, gitHeadPath, store);

            // if (path !== 'HEAD') return;
            // statusBarItem.text = '$(sync~spin) SARIF Updating...';
        });
    }

    async function onGitChanged(repo: Repository, gitHeadPath: string, store: Store) {
        // Get current branch. No better way:
        // * repo.log does not show branch info
        // * repo.getBranch('') returns the alphabetical first
        // * repo.getBranches({ remote: true }) doesn't show which is the current
        const branchRef = readFileSync(gitHeadPath, 'utf8').replace('ref: ', '').trim(); // example: refs/heads/demo
        const branchName = branchRef.replace('refs/heads/', '');

        // TODO: Guard against !branchRef.startsWith('ref: refs/heads/')

        // Get local hash
        const commitLocal = await repo.getCommit(branchRef);
        store.commitHash = commitLocal.hash;

        // Get remote hash (if it exists).
        const branches = await repo.getBranches({ remote: true });
        const commitOrigin = branches.find(branch => branch.name === `origin/${branchName}`);
        if (!commitOrigin) {
            panel.setBanner('No origin branch found.');
            return;
        }

        // Compare hashes
        if (commitLocal.hash === commitOrigin?.commit) {
            store.branch = `${branchName}=`;
        } else {
            const log = await repo.log({});
            const i = log.findIndex(commit => commit.hash === commitOrigin?.commit);
            store.branch = i < 0 ? `${branchName}-` : `${branchName}+${i}`;
        }
    }

    async function pollerRepeatAction() {
        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session;
        if (!accessToken) {
            panel.setBanner('Unable to authenticate.');
            return true; // console.warn('No accessToken');
        }

        let branchName = store.branch.slice(0, -1);
        if (branchName === 'mar25') branchName = 'main';
        const analysesResponse = await fetch(`https://api.github.com/repos/${config.user}/${config.repoName}/code-scanning/analyses?ref=refs/heads/${branchName}`, {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });
        if (analysesResponse.status === 403) {
            panel.setBanner('GitHub Advanced Security is not enabled for this repository.');
            return true;
        }
        const analyses = await analysesResponse.json() as { id: number, commit_sha: string }[];

        // Possibilities:
        // a) analysis is not enabled for repo or branch.
        // b) analysis is enabled, but pending.
        if (!analyses.length) {
            return false;
        }

        const analysesForCommit = analyses.filter(analysis => analysis.commit_sha === store.commitHash);

        // Possibilities:
        // a) analysis pending
        // b) local is ahead of remote? trust that caller will start/stop
        if (!analysesForCommit.length) {
            return false;
        }

        // return results
        return analysesForCommit[0].id;
    }

    async function pollerFinalAction(analysisId: number | undefined) {
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
            panel.setBanner('Results updated for current branch.');
        } else {
            panel.setBanner('');
        }

        panel.show();
        statusBarItem.text = defaultStatusText;
    }
}
