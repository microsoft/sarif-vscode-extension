// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { watch } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { intercept, IValueWillChange, observe } from 'mobx';
import fetch, { FetchError } from 'node-fetch';
import { Log } from 'sarif';
import { authentication, Disposable, extensions, OutputChannel, ProgressLocation, window, workspace } from 'vscode';
import { augmentLog } from '../shared';
import { API, GitExtension, Repository } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { isSpinning } from './statusBarItem';
import { Store } from './store';
import { sendGithubConfig, sendGithubEligibility, sendGithubPromptChoice, sendGithubAnalysisFound } from './telemetry';

// Subset of the GitHub API.
interface AnalysisInfo {
    id: number;
    commit_sha: string;
    created_at: string;
    tool: { name: string };
    results_count: number;
}

// A concise representation of AnalysisInfo[] aligned by commit.
export interface AnalysisInfosForCommit {
    ids: number[];
    commit_sha: string; // All analyses of this group, by definition, have the same commit.
    created_at: string; // The latest `created_at` of the group.
    commitsAgo: number;
}

let currentLogUris: string[] | undefined = undefined;

let output: OutputChannel | undefined;

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

// In the case of sub-modules, pick the root repo.
export function getPrimaryRepository(git: API): Repository | undefined {
    const primaryWorkspaceFolderUriString = workspace.workspaceFolders?.[0]?.uri.toString(); // No trailing slash
    return git.repositories.filter(repo => repo.rootUri.toString() === primaryWorkspaceFolderUriString)[0];
}

export type ConnectToGithubCodeScanning = 'off' | 'on' | 'prompt'

export function activateGithubAnalyses(disposables: Disposable[], store: Store, panel: Panel, outputChannel: OutputChannel) {
    output = outputChannel;

    disposables.push(workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration('sarif-viewer.connectToGithubCodeScanning')) return;
        const connectToGithubCodeScanning = workspace.getConfiguration('sarif-viewer').get<ConnectToGithubCodeScanning>('connectToGithubCodeScanning');
        sendGithubConfig(connectToGithubCodeScanning ?? 'undefined');
    }));

    // See configurations comments at the bottom of this file.
    const connectToGithubCodeScanning = workspace.getConfiguration('sarif-viewer').get<ConnectToGithubCodeScanning>('connectToGithubCodeScanning');
    if (connectToGithubCodeScanning === 'off') return;

    const config = {
        user: '',
        repoName: '',
    };

    (async () => {
        const git = await getInitializedGitApi();
        if (!git) return sendGithubEligibility('No Git api');

        const repo = getPrimaryRepository(git);
        if (!repo) return sendGithubEligibility('No Git repository');

        const origin = await repo.getConfig('remote.origin.url');

        const [, user, repoName] = (() => {
            // Example: https:/github.com/user/repoName.git
            const matchHTTPS = origin.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)/);
            if (matchHTTPS) return matchHTTPS;

            // Example: git@github.com:user/repoName.git
            const matchSSH = origin.match(/git@github\.com:([^/]+)\/([^/]+)/);
            if (matchSSH) return matchSSH;

            return [];
        })();

        if (!user || !repoName) return sendGithubEligibility('No GitHub origin');
        config.user = user;
        config.repoName = repoName.replace('.git', ''); // A repoName may optionally end with '.git'. Normalize it out.

        // proccess.cwd() returns '/'
        const workspacePath = workspace.workspaceFolders?.[0]?.uri?.fsPath; // TODO: Multiple workspaces.
        if (!workspacePath) return sendGithubEligibility('No workspace');
        const gitHeadPath = `${workspacePath}/.git/HEAD`;
        if (!existsSync(gitHeadPath)) return sendGithubEligibility('No .git/HEAD');

        sendGithubEligibility('Eligible');

        if (connectToGithubCodeScanning === 'prompt') {
            const choice = await window.showInformationMessage(
                'This repository has an origin (GitHub) that may have code scanning results. Connect to GitHub and display these results?',
                'Connect', 'Not now', 'Never',
            );
            sendGithubPromptChoice(choice);
            if (choice === 'Never') {
                workspace.getConfiguration('sarif-viewer').update('connectToGithubCodeScanning', 'off');
            } else if (choice === 'Connect') {
                const analysisFound = await window.withProgress<boolean>({ location: ProgressLocation.Notification }, async progress => {
                    progress.report({ increment: 20 }); // 20 is arbitrary as we have a non-deterministic number of steps.
                    await onRefsHeadsChanged(repo, gitHeadPath, store);
                    const analysisInfos = await fetchAnalysisInfos(config.user, config.repoName, store.branch, message => {
                        progress.report({ message, increment: 20 });
                    });
                    if (analysisInfos) {
                        workspace.getConfiguration('sarif-viewer').update('connectToGithubCodeScanning', 'on');
                        await panel.show();
                        store.analysisInfos = analysisInfos;
                        beginWatch(repo);
                    }
                    return !!analysisInfos;
                });

                if (!analysisFound) {
                    const choiceTryAgain = await window.showInformationMessage(
                        'No results found. Ask again next time? This can be changed in the settings.',
                        'Yes', 'No',
                    );
                    sendGithubAnalysisFound(`Not Found: ${choiceTryAgain ?? 'undefined'}`);
                    if (choiceTryAgain === 'No') {
                        workspace.getConfiguration('sarif-viewer').update('connectToGithubCodeScanning', 'off');
                    }
                } else {
                    sendGithubAnalysisFound('Found');
                }
            }
        } else {
            // At this point all the local requirements have been satisfied.
            // We preemptively show the panel (even before the result as fetched)
            // so that the banner is visible.
            await panel.show();
            await onRefsHeadsChanged(repo, gitHeadPath, store);
            store.analysisInfos = await fetchAnalysisInfos(config.user, config.repoName, store.branch, message => store.banner = message);
            beginWatch(repo);
        }

        function beginWatch(repo: Repository) {
            const watcher = watch([
                `${workspacePath}/.git/refs/heads`, // TODO: Only watch specific branch.
            ], { ignoreInitial: true });
            watcher.on('all', async (/* examples: eventName = change, path = .git/refs/heads/demo */) => {
                await onRefsHeadsChanged(repo, gitHeadPath, store);
                store.analysisInfos = await fetchAnalysisInfos(config.user, config.repoName, store.branch, message => store.banner = message);
            });
        }
    })();

    async function onRefsHeadsChanged(repo: Repository, gitHeadPath: string, store: Store) {
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
    }

    // TODO: Block re-entrancy.
    interceptAnalysisInfo(store);
    observe(store, 'analysisInfos', () => fetchAnalysis(store, config, panel));
    observe(store, 'remoteAnalysisInfoUpdated', async () => {
        store.analysisInfos = await fetchAnalysisInfos(config.user, config.repoName, store.branch, message => store.banner = message);
    });
}

export async function fetchAnalysisInfos(owner: string, repo: string, branch: string, updateMessage: (message: string) => void): Promise<AnalysisInfosForCommit | undefined> {
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
        const analysesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/code-scanning/analyses?ref=refs/heads/${branch}`, {
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
        output?.appendLine(`Analyses:\n${analysesString}\n`);

        // STEP 4: Cross-reference with Git
        const git = await getInitializedGitApi();
        if (!git) {
            updateMessage('Unable to initialize Git.'); // No GitExtension or GitExtension API.
            return undefined;
        }

        // Find the intersection.
        const commits = await getPrimaryRepository(git)?.log({}) ?? [];
        const commitsString = commits.map(({ commitDate, hash }) => `${commitDate?.toISOString().replace('.000', '')} ${hash}`).join('\n');
        output?.appendLine(`Commits:\n${commitsString}\n`);
        const intersectingCommit = analyses.find(analysis => {
            return commits.some(commit => analysis.commit_sha === commit.hash);
        })?.commit_sha;

        if (!intersectingCommit) {
            updateMessage('No intersecting commit.');
            return undefined;
        }

        // STEP 5: Filter out duplicate tools.
        // GitHub sorts analyses by most recent first.
        const toolsSeen = new Set<string>();
        const analysisInfos = analyses.filter(analysis => {
            if (analysis.commit_sha !== intersectingCommit) return false;

            // Some repos have duplicate logs/runs per commit. To mitigate this, we only allow one run/log per tool.
            if (toolsSeen.has(analysis.tool.name)) return false;

            toolsSeen.add(analysis.tool.name);
            return true;
        });
        if (!analysisInfos.length) {
            return undefined;
        }

        return {
            ids: analysisInfos.map(info => info.id),
            commit_sha: intersectingCommit,
            created_at: analysisInfos?.[0].created_at, // `analysisInfos` is already ordered by most recent first.
            commitsAgo: commits.findIndex(commit => commit.hash === intersectingCommit),
        };

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

function setBannerResultsUpdated(store: Store, analysisInfo: AnalysisInfosForCommit | undefined, verb: 'updated' | 'unchanged' = 'updated') {
    if (!analysisInfo) return;

    const messageWarnStale = analysisInfo.commit_sha !== store.commitHash
        ? ` The most recent scan was ${analysisInfo.commitsAgo} commit(s) ago` +
        ` on ${new Date(analysisInfo.created_at).toLocaleString()}.` +
        ` Refresh to check for more current results.`
        : '';
    store.banner = `Results ${verb} for current commit ${store.commitHash.slice(0, 7)}.` + messageWarnStale;
}

export function interceptAnalysisInfo(store: Store) {
    intercept(store, 'analysisInfos', (change: IValueWillChange<AnalysisInfosForCommit | undefined>) => {
        const newAnalysisInfo = change.newValue;

        // If `analysisInfo` is undefined at this point, then...
        // a) the intersection is outside of the page size
        // b) other?
        if (newAnalysisInfo) {
            if (JSON.stringify(store.analysisInfos?.ids) !== JSON.stringify(newAnalysisInfo.ids)) { // Lazy array comparison technique.
                store.banner = 'Updating...'; // fetchAnalysis() will call setBannerResultsUpdated()
                return change; // allow change
            } else {
                setBannerResultsUpdated(store, newAnalysisInfo, 'unchanged');
                return null; // block the change
            }
        } else {
            // In the first page analyses, but none that match this commit.
            // Possibilities:
            // a) User checked-out a really old commit.
            // b) Not all branches are scanned.
            store.banner = `This branch has not been scanned.`;
            if (store.analysisInfos !== undefined) {
                return change; // allow change
            } else {
                return null; // block change
            }
        }
    });
}

async function fetchAnalysis(store: Store, config: { user: string, repoName: string }, panel: Panel): Promise<void> {
    isSpinning.set(true);

    const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
    const { accessToken } = session; // Assume non-null as we already called it recently.

    const analysisInfo = store.analysisInfos;
    const logs = !analysisInfo?.ids.length // AnalysesForCommit.ids should not be zero-length, but this is an extra guard.
        ? undefined
        : await (async () => {
            try {
                const logs = [] as Log[];
                for (const analysisId of analysisInfo.ids) {
                    const uri = `https://api.github.com/repos/${config.user}/${config.repoName}/code-scanning/analyses/${analysisId}`;
                    const analysisResponse = await fetch(uri, {
                        headers: {
                            accept: 'application/sarif+json',
                            authorization: `Bearer ${accessToken}`,
                        },
                    });
                    const logText = await analysisResponse.text();
                    // Useful for saving/examining fetched logs:
                    // (await import('fs')).writeFileSync(`${workspace.workspaceFolders?.[0]?.uri.fsPath}/${analysisInfo.id}.sarif`, logText);
                    const log = JSON.parse(logText) as Log;
                    log._text = logText;
                    log._uri = uri;
                    const primaryWorkspaceFolderUriString = workspace.workspaceFolders?.[0]?.uri.toString(); // No trailing slash
                    augmentLog(log, driverlessRules, primaryWorkspaceFolderUriString);
                    logs.push(log);
                }
                return logs;
            } catch (error) {
                output?.append(`Error in fetchAnalysis: ${error}\n`);
                return undefined;
            }
        })();

    if (currentLogUris) {
        for (const currentLogUri of currentLogUris) {
            store.logs.removeFirst(log => log._uri === currentLogUri);
        }
        currentLogUris = undefined;
    }

    if (logs) {
        store.logs.push(...logs);
        currentLogUris = logs.map(log => log._uri);
    }

    panel.show();
    isSpinning.set(false);

    setBannerResultsUpdated(store, analysisInfo);
}

/*
    Regarding workspace.getConfiguration():
    Determined (via experiments) that is not possible to discern between default and unset.
    This is even when using `inspect()`.

    If equal to default (false or unset):
    {
        defaultValue: false
        key: ...
    }

    If not equal to default (true):
    {
        defaultValue: false
        globalValue: true
    }
*/
