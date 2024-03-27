// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { watch } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { observe } from 'mobx';
import fetch, { Response } from 'node-fetch';
import { Fix, Log, Result } from 'sarif';
import { authentication, ConfigurationTarget, Disposable, extensions, OutputChannel, ProgressLocation, window, workspace } from 'vscode';
import { augmentLog } from '../shared';
import '../shared/extension';
import { API, GitExtension, Repository } from './git';
import { driverlessRules } from './loadLogs';
import { Panel } from './panel';
import { isSpinning } from './statusBarItem';
import { Store } from './store';
import { sendGithubConfig, sendGithubEligibility, sendGithubPromptChoice, sendGithubAnalysisFound, sendGithubAutofixApplied } from './telemetry';
import { applyFix } from './index.activateFixes';
import { UriRebaser } from './uriRebaser';

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

//  'off' | 'on' | 'prompt' are valid setting values. 'injected' is used if there is a value for
// githubCodeScanningInitialAlert.
type ConnectToGithubCodeScanning = 'off' | 'on' | 'prompt' | 'injected';

export function activateGithubAnalyses(disposables: Disposable[], store: Store, panel: Panel, outputChannel: OutputChannel) {
    disposables.push(workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration('sarif-viewer.connectToGithubCodeScanning')) return;
        const connectToGithubCodeScanning = workspace.getConfiguration('sarif-viewer').get<ConnectToGithubCodeScanning>('connectToGithubCodeScanning');
        sendGithubConfig(connectToGithubCodeScanning ?? 'undefined');
    }));

    // See configurations comments at the bottom of this file.
    const fullCodeScanningAlert = workspace.getConfiguration('sarif-viewer').get<string>('githubCodeScanningInitialAlert');
    const connectToGithubCodeScanning: ConnectToGithubCodeScanning = fullCodeScanningAlert
        ? 'injected'
        : workspace.getConfiguration('sarif-viewer').get<ConnectToGithubCodeScanning>('connectToGithubCodeScanning', 'prompt');
    outputChannel.appendLine(`Connect to GitHub Code Scanning: ${connectToGithubCodeScanning}.`);
    if (connectToGithubCodeScanning === 'off') {
        return;
    }
    const config = {
        user: '',
        repoName: '',
    };

    (async () => {
        const git = await getInitializedGitApi();
        if (!git) {
            outputChannel.appendLine('Not eligible to connect to GitHub Code Scanning: No Git api.');
            return sendGithubEligibility('No Git api');
        }

        const repo = getPrimaryRepository(git);
        if (!repo) {
            outputChannel.appendLine('Not eligible to connect to GitHub Code Scanning: No Git repository.');
            return sendGithubEligibility('No Git repository');
        }

        const origin = await findRemote(repo, outputChannel);
        if (!origin) {
            outputChannel.appendLine('Not eligible to connect to GitHub Code Scanning: No remote');
            return sendGithubEligibility('No remote');
        }

        const [, user, repoName] = (() => {
            // Example: https://github.com/user/repoName.git
            const matchHTTPS = origin.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)/);
            if (matchHTTPS) return matchHTTPS;

            // Example: git@github.com:user/repoName.git
            const matchSSH = origin.match(/git@github\.com:([^/]+)\/([^/]+)/);
            if (matchSSH) return matchSSH;

            return [];
        })();

        if (!user || !repoName) {
            outputChannel.appendLine('Not eligible to connect to GitHub Code Scanning: No GitHub origin.');
            return sendGithubEligibility('No GitHub origin');
        }
        config.user = user;
        config.repoName = repoName.replace('.git', ''); // A repoName may optionally end with '.git'. Normalize it out.
        outputChannel.appendLine(`Repository name with owner: ${config.user}/${config.repoName}.`);

        // process.cwd() returns '/'
        const workspacePath = workspace.workspaceFolders?.[0]?.uri?.fsPath; // TODO: Multiple workspaces.
        if (!workspacePath) {
            outputChannel.appendLine('Not eligible to connect to GitHub Code Scanning: No workspace.');
            return sendGithubEligibility('No workspace');
        }
        const gitHeadPath = `${workspacePath}/.git/HEAD`;
        if (!existsSync(gitHeadPath)) {
            outputChannel.appendLine('Not eligible to connect to GitHub Code Scanning: No .git/HEAD.');
            return sendGithubEligibility('No .git/HEAD');
        }

        outputChannel.appendLine('Eligible to connect to GitHub Code Scanning.');
        sendGithubEligibility('Eligible');

        let showPanel = connectToGithubCodeScanning !== 'prompt';
        if (connectToGithubCodeScanning === 'prompt') {
            const choice = await window.showInformationMessage(
                'This repository has an origin (GitHub) that may have code scanning results. Connect to GitHub and display these results?',
                'Connect', 'Not now', 'Never',
            );
            sendGithubPromptChoice(choice);
            if (choice === 'Never') {
                outputChannel.appendLine('Never connect to GitHub Code Scanning by user request.');
                workspace.getConfiguration('sarif-viewer').update('connectToGithubCodeScanning', 'off');
            } else if (choice === 'Connect') {
                const analysisFound = await window.withProgress<boolean>({ location: ProgressLocation.Notification }, async progress => {
                    progress.report({ increment: 20 }); // 20 is arbitrary as we have a non-deterministic number of steps.
                    await onBranchChanged(repo, gitHeadPath, true);
                    const analysisInfo = await fetchAnalysisInfo(message => {
                        progress.report({ message, increment: 20 });
                    });
                    if (analysisInfo) {
                        workspace.getConfiguration('sarif-viewer').update('connectToGithubCodeScanning', 'on');
                        await panel.show();
                        updateAnalysisInfo(analysisInfo);
                        beginWatch(repo);
                    }
                    return !!analysisInfo;
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
                    showPanel = true;
                }
            }
        }

        if (!showPanel) {
            return;
        }

        // At this point all the local requirements have been satisfied.
        // We preemptively show the panel (even before the result is fetched)
        // so that the banner is visible.
        await panel.show();

        if (connectToGithubCodeScanning === 'injected') {
            // bypass downloading analyses. Instead, use the fullCodeScanningAlert as the analysis to apply.
            await handleSingleLog(fullCodeScanningAlert!, outputChannel);

            // Now that the analysis has been successfully applied, avoid re-applying it in the future.
            // Make sure to update the config value to '' instead of `undefined` to ensure that the
            // default value is not used. This default value may have been injected by a codespace.
            await workspace.getConfiguration('sarif-viewer').update('githubCodeScanningInitialAlert', '', ConfigurationTarget.Global);
        } else {
            // Note that if connectToGithubCodeScanning is undefined, it is treated as 'on'.
            // Force a fetch of the analysis for the current branch.
            await onBranchChanged(repo, gitHeadPath);
        }

        beginWatch(repo);

        function beginWatch(repo: Repository) {
            const watcher = watch([
                `${workspacePath}/.git/refs/heads`, // TODO: Only watch specific branch.
            ], { ignoreInitial: true });
            watcher.on('all', (/* examples: eventName = change, path = .git/refs/heads/demo */) => {
                onBranchChanged(repo, gitHeadPath);
            });
        }
    })();

    async function onBranchChanged(repo: Repository, gitHeadPath: string, skipAnalysisInfo = false) {
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
        if (!skipAnalysisInfo) {
            const analysisInfo = await fetchAnalysisInfo(message => store.banner = message);
            updateAnalysisInfo(analysisInfo);
        }
    }

    async function fetchAnalysisInfo(updateMessage: (message: string) => void): Promise<AnalysisInfosForCommit | undefined> {
        updateMessage('Checking GitHub Advanced Security...');

        // STEP 1: Auth
        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session;
        if (!accessToken) {
            updateMessage('Unable to authenticate.');
            return undefined;
        }

        // STEP 2: Fetch
        const branchName = store.branch;
        let analysesResponse: Response | undefined;
        try {
            // Useful for debugging the progress indicator: await new Promise(resolve => setTimeout(resolve, 2000));
            analysesResponse = await fetch(`https://api.github.com/repos/${config.user}/${config.repoName}/code-scanning/analyses?ref=refs/heads/${branchName}`, {
                headers: {
                    authorization: `Bearer ${accessToken}`,
                },
            });
        } catch (error) {
            // Expected error value if the network is disabled.
            // {
            //     "message": "request to https://api.github.com/repos/microsoft/sarif-vscode-extension/code-scanning/analyses?ref=refs/heads/main failed, reason: getaddrinfo ENOTFOUND api.github.com",
            //     "type": "system",
            //     "errno": "ENOTFOUND",
            //     "code": "ENOTFOUND"
            // }
            updateMessage('Network error. Refresh to try again.');
        }
        if (!analysesResponse) {
            return undefined;
        }
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

        // STEP 4: Cross-reference with Git
        const git = await getInitializedGitApi();
        if (!git) {
            updateMessage('Unable to initialize Git.'); // No GitExtension or GitExtension API.
            return undefined;
        }

        // Find the intersection.
        const repo = getPrimaryRepository(git);
        const commits = await repo?.log({}) ?? [];
        const commitsString = commits.map(({ commitDate, hash }) => `${commitDate?.toISOString().replace('.000', '')} ${hash}`).join('\n');
        outputChannel.appendLine(`Commits:\n${commitsString}\n`);
        const intersectingCommit = analyses.find(analysis => {
            return commits.some(commit => analysis.commit_sha === commit.hash);
        })?.commit_sha;

        if (!intersectingCommit) {
            return undefined;
        }

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

    function updateAnalysisInfo(analysisInfo: AnalysisInfosForCommit | undefined): void {
        // If `analysisInfo` is undefined at this point, then...
        // a) the intersection is outside of the page size
        // b) other?
        if (analysisInfo) {
            if (JSON.stringify(store.analysisInfo?.ids) !== JSON.stringify(analysisInfo.ids)) { // Lazy array comparison technique.
                store.analysisInfo = analysisInfo;
                // Banner will be updated during fetchAnalysis()
            } else {
                setBannerResultsUpdated(analysisInfo, 'unchanged');
            }
        } else {
            // In the first page analyses, but none that match this commit.
            // Possibilities:
            // a) User checked-out a really old commit.
            // b) Not all branches are scanned.
            if (store.analysisInfo !== undefined) {
                store.analysisInfo = undefined;
            }
            store.banner = `This branch has not been scanned.`;
        }
    }

    async function fetchAnalysis(analysisInfo: AnalysisInfosForCommit | undefined): Promise<void> {
        isSpinning.set(true);

        const session = await authentication.getSession('github', ['security_events'], { createIfNone: true });
        const { accessToken } = session; // Assume non-null as we already called it recently.

        const ids = analysisInfo?.ids;
        const logs = !ids?.length // AnalysesForCommit.ids should not be zero-length, but this is an extra guard.
            ? undefined
            : await (async () => {
                try {
                    const logs = [] as Log[];
                    for (const analysisId of ids) {
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
                        const log = parseLog(logText, uri);
                        logs.push(log);
                    }
                    return logs;
                } catch (error) {
                    outputChannel.append(`Error in fetchAnalysis: ${error}\n`);
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
        setBannerResultsUpdated(analysisInfo);
    }

    async function handleSingleLog(logText: string, outputChannel: OutputChannel) {
        try {
            const log = parseLog(logText);
            outputChannel.appendLine(`Handling injected log with ${log.runs.length} runs.`);
            store.logs.push(log);
            await applyFixes(log, outputChannel);
            panel.show();
            isSpinning.set(false);
            store.banner = `Results loaded for default alert.`;
            outputChannel.appendLine('Success.');
            sendGithubAutofixApplied('success');
        } catch (e) {
            window.showErrorMessage(`Unable to parse SARIF and apply fixes: ${errorToString(e)}`);
            outputChannel.appendLine(`Unable to parse SARIF and apply fixes: ${errorToString(e)}`);
            sendGithubAutofixApplied('failure', errorToString(e));
        }
    }

    async function applyFixes(log: Log, outputChannel: OutputChannel) {
        outputChannel.appendLine('Applying fixes...');
        const baser = new UriRebaser(store);
        const fixes: { result: Result, fix: Fix }[] = [];

        // Gather all fixes
        log.runs?.forEach(run => {
            run.results?.forEach(result => {
                result.fixes?.forEach(fix => fixes.push({ result, fix }));
            });
        });
        outputChannel.appendLine(`Found ${fixes.length} fix(es).`);

        // Apply them serially
        for (const f of fixes) {
            await applyFix(f.fix, f.result, baser, store, outputChannel);
        }
    }

    function setBannerResultsUpdated(analysisInfo: AnalysisInfosForCommit | undefined, verb: 'updated' | 'unchanged' = 'updated') {
        if (!analysisInfo) return;

        const messageWarnStale = analysisInfo.commit_sha !== store.commitHash
            ? ` The most recent scan was ${analysisInfo.commitsAgo} commit(s) ago` +
            ` on ${new Date(analysisInfo.created_at).toLocaleString()}.` +
            ` Refresh to check for more current results.`
            : '';
        store.banner = `Results ${verb} for current commit ${store.commitHash.slice(0, 7)}.` + messageWarnStale;
    }

    // TODO: Block re-entrance.
    observe(store, 'analysisInfo', () => fetchAnalysis(store.analysisInfo));
    observe(store, 'remoteAnalysisInfoUpdated', async () => {
        const analysisInfo = await fetchAnalysisInfo(message => store.banner = message);
        updateAnalysisInfo(analysisInfo);
    });
}

function errorToString(e: unknown) {
    return e instanceof Error ? e.message : String(e);
}

function parseLog(logText: string, uri = 'file:///synthetic.sarif') {
    const log = JSON.parse(logText) as Log;
    log._text = logText;
    log._uri = uri;
    const primaryWorkspaceFolderUriString = workspace.workspaceFolders?.[0]?.uri.toString(true); // No trailing slash
    augmentLog(log, driverlessRules, primaryWorkspaceFolderUriString);
    return log;
}

/**
 * Gets the URL associated with the remote to retrieve alerts for.
 * Uses these heuristics in order:
 *
 * 1. The remote associated with the current head
 * 2. The `origin` remote
 * 3. The first remote in the configuration
 * 4. undefined
 *
 * On codespaces, if this extension starts too early, then the Git API may not be fully
 * initialized. Even though the git extension is activated, the codespace's filesystem
 * may not be ready. This is why we retry a few times.
 *
 * @param repo The repo to retrieve analyses for
 * @returns the url associated with this remote or undefined if there are no remotes
 * for this repo.
 */
async function findRemote(repo: Repository, outputChannel: OutputChannel): Promise<string | undefined> {
    let remoteUrl: string | undefined;
    for(let count = 0; count < 5 && !remoteUrl; count++) {
        const remoteName = repo.state.HEAD?.upstream?.remote || 'origin';
        remoteUrl = repo.state.remotes.find(remote => remote.name === remoteName)?.fetchUrl;
        if (!remoteUrl && repo.state.remotes.length) {
            remoteUrl = repo.state.remotes[0].fetchUrl;
        }
        if (!remoteUrl) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for Git to initialize.
            outputChannel.appendLine('Git not initialized. Waiting...');
        }
    }

    return remoteUrl;
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
