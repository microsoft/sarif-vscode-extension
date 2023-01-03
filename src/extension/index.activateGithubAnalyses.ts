// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { watch } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { intercept, IValueWillChange, observe } from 'mobx';
import { Log } from 'sarif';
import { Disposable, extensions, OutputChannel, ProgressLocation, window, workspace } from 'vscode';
import { augmentLog } from '../shared';
import { AnalysisProviderGithub } from './analysisProviderGithub';
import { API, GitExtension, Repository } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { isSpinning } from './statusBarItem';
import { Store } from './store';
import { sendGithubConfig, sendGithubEligibility, sendGithubPromptChoice, sendGithubAnalysisFound } from './telemetry';

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
        const provider = new AnalysisProviderGithub(
            user,
            repoName.replace('.git', ''), // A repoName may optionally end with '.git'. Normalize it out.
        );

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
                    const analysisInfos = await fetchAnalysisInfos(provider, store.branch, message => {
                        progress.report({ message, increment: 20 });
                    });
                    if (analysisInfos) {
                        workspace.getConfiguration('sarif-viewer').update('connectToGithubCodeScanning', 'on');
                        await panel.show();
                        beginReactions();
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
            beginReactions();
            store.analysisInfos = await fetchAnalysisInfos(provider, store.branch, message => store.banner = message);
            beginWatch(repo);
        }

        function beginReactions() {
            // TODO: Block re-entrancy.
            interceptAnalysisInfo(store);
            observe(store, 'analysisInfos', () => fetchAnalysis(store, provider, panel));
            observe(store, 'remoteAnalysisInfoUpdated', async () => {
                store.analysisInfos = await fetchAnalysisInfos(provider, store.branch, message => store.banner = message);
            });
        }

        function beginWatch(repo: Repository) {
            const watcher = watch([
                `${workspacePath}/.git/refs/heads`, // TODO: Only watch specific branch.
            ], { ignoreInitial: true });
            watcher.on('all', async (/* examples: eventName = change, path = .git/refs/heads/demo */) => {
                await onRefsHeadsChanged(repo, gitHeadPath, store);
                store.analysisInfos = await fetchAnalysisInfos(provider, store.branch, message => store.banner = message);
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
}

export async function fetchAnalysisInfos(provider: AnalysisProviderGithub, branch: string, updateMessage: (message: string) => void): Promise<AnalysisInfosForCommit | undefined> {
    const analyses = await provider.fetchAnalysisInfos(branch, updateMessage, output);
    if (!analyses) {
        return undefined; // Error messaging should have been handled by provider already.
    }

    // Cross-reference with Git
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

    // Filter out duplicate tools.
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

async function fetchAnalysis(store: Store, provider: AnalysisProviderGithub, panel: Panel): Promise<void> {
    isSpinning.set(true);

    const analysisInfo = store.analysisInfos;
    const logs = !analysisInfo?.ids.length // AnalysesForCommit.ids should not be zero-length, but this is an extra guard.
        ? undefined
        : await (async () => {
            try {
                const logInfos = await provider.fetchAnalysis(analysisInfo.ids);
                return logInfos.map(logInfo => {
                    // Useful for saving/examining fetched logs:
                    // (await import('fs')).writeFileSync(`${workspace.workspaceFolders?.[0]?.uri.fsPath}/${logInfo.analysisId}.sarif`, logInfo.text);
                    const log = JSON.parse(logInfo.text) as Log;
                    log._text = logInfo.text;
                    log._uri = logInfo.uri;
                    const primaryWorkspaceFolderUriString = workspace.workspaceFolders?.[0]?.uri.toString(); // No trailing slash
                    augmentLog(log, driverlessRules, primaryWorkspaceFolderUriString);
                    return log;
                });
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
