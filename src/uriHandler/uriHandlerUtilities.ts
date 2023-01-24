// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { RepoMappingMetadata, UriAction } from './uriHandlerInterfaces';

import { Extension } from '../extension';
import { UriHandler } from './uriHandler';
import { Utilities } from '../utilities/utilities';

/**
 * Extension URI handler helper utilities.
 */
export class UriHandlerUtilities {
    /**
     * Gets or creates a repository mapping for a given repository name when a URI handler is initiated.
     * @param {string} repoName The name of the repository to open.
     * @returns {Promise<vscode.Uri | undefined>} The repo mapping URI or undefined.
     */
    public static async tryGetRepoMapping(repoName: string): Promise<vscode.Uri | undefined> {
        // Check if the repo has already been mapped to a file system path.
        const mapResult: Record<string, string> | undefined = Extension.extensionContext.globalState.get(repoName.toLowerCase());

        // If a mapped repo path was found, check that it still exists before returning.
        if (mapResult && fs.existsSync(mapResult.repoPath)) {
            return vscode.Uri.file(mapResult.repoPath);
        }

        // Attempt search heuristics to find the repo name.
        const repoMatches: string[] | undefined = UriHandlerUtilities.tryFindGitRepo(repoName);
        if (repoMatches) {
            return vscode.Uri.file(repoMatches.length > 1 ? await UriHandlerUtilities.handleMultipleRepoMatches(repoName, repoMatches) : repoMatches[0]);
        }

        return undefined;
    }

    /**
     * Attempts to automatically find a given repository using the following heuristics:
     * 1. Check if repo exists in git.defaultCloneDirectory.
     * 2. Check if repo exists in %USERPROFILE%\Source\repos (default VS clone location).
     * 3. Check if repo is in the drive of the opened VSCode workspace (wherever the user is currently working).
     * 4. Check the root of %USERPROFILE%.
     * 5. Search current process drive root (if different from above) with a maximum search depth of 2 directory levels.
     * 6. Check the D: drive if that wasn't already searched.
     * 7. Check the E: drive if that wasn't already searched.
     * @param {string} repoName The name of the repository to search for.
     * @returns {string[] | undefined} The list of repository paths matching the repository name or undefined if we couldn't find any matches.
     */
    public static tryFindGitRepo(repoName: string): string[] | undefined {
        // If there are multiple matches, prompt the user to select the desired match.
        let repoMatches: string[] = [];

        // Check git.defaultCloneDirectory to see if the user has the desired repository cloned there.
        const gitDefaultCloneDirectory: string | undefined = vscode.workspace.getConfiguration('git').get<string>('defaultCloneDirectory');
        if (gitDefaultCloneDirectory) {
            const repoPath: string = path.join(gitDefaultCloneDirectory, repoName);
            if (fs.existsSync(path.join(repoPath, '.git'))) {
                return [repoPath];
            }
        }

        // Check if repo is in %USERPROFILE%\Source\repos (default VS clone location).
        const defaultVSCloneDirectory: string | undefined = path.join(os.homedir(), 'source\\repos');
        const repoPath: string = path.join(defaultVSCloneDirectory, repoName);
        if (fs.existsSync(path.join(repoPath, '.git'))) {
            return [repoPath];
        }

        // Check if repo is in the drive of the opened VSCode workspace (wherever the user is currently working).
        const workspaceDriveRootPath: string | undefined = Utilities.getWorkspaceFolder()?.substring(0, 3);
        if (workspaceDriveRootPath && fs.existsSync(workspaceDriveRootPath)) {
            repoMatches = UriHandlerUtilities.findGitRepoInPath(repoName, workspaceDriveRootPath, 0, repoMatches);
            if (repoMatches.length > 0) {
                return repoMatches;
            }
        }

        // Use the process execution path to parse the current drive path. Search here if it is different from the previous workspace drive path.
        const driveRootPath: string = process.execPath.substring(0, 3);
        if (driveRootPath.toLowerCase() !== workspaceDriveRootPath?.toLowerCase() && fs.existsSync(driveRootPath)) {
            repoMatches = UriHandlerUtilities.findGitRepoInPath(repoName, driveRootPath, 0, repoMatches);
            if (repoMatches.length > 0) {
                return repoMatches;
            }
        }

        // Check %USERPROFILE%.
        const userProfilePath: string = os.homedir();
        if (fs.existsSync(userProfilePath)) {
            repoMatches = UriHandlerUtilities.findGitRepoInPath(repoName, userProfilePath, 0, repoMatches);
            if (repoMatches.length > 0) {
                return repoMatches;
            }
        }

        // If we still haven't found it, check the D: drive as that is a common repo clone location and the default repo clone location for WaveSpaces.
        const dDriveRootPath = 'D:\\';
        if (dDriveRootPath.toLowerCase() !== workspaceDriveRootPath?.toLowerCase() && dDriveRootPath.toLowerCase() !== driveRootPath.toLowerCase() && fs.existsSync(dDriveRootPath)) {
            repoMatches = UriHandlerUtilities.findGitRepoInPath(repoName, dDriveRootPath, 0, repoMatches);
            if (repoMatches.length > 0) {
                return repoMatches;
            }
        }

        // If we still haven't found it, check the E: drive.
        const eDriveRootPath = 'E:\\';
        if (eDriveRootPath.toLowerCase() !== workspaceDriveRootPath?.toLowerCase() && eDriveRootPath.toLowerCase() !== driveRootPath.toLowerCase() && fs.existsSync(eDriveRootPath)) {
            repoMatches = UriHandlerUtilities.findGitRepoInPath(repoName, eDriveRootPath, 0, repoMatches);
            if (repoMatches.length > 0) {
                return repoMatches;
            }
        }

        return undefined;
    }

    /**
     * Searches for a git repository given a directory starting path.
     * @param {string} repoName The repository name to search for.
     * @param {string} dirPath The directory path to start the repository search.
     * @param {string} currentDepth The current search depth.
     * @param {string[]} repoMatches A list of repository paths matching the specified search name.
     * @param {string} maxDepth The max search depth before returning.
     * @returns {string[]} A list of repository paths matching the specified search name.
     */
    public static findGitRepoInPath(repoName: string, dirPath: string, currentDepth: number, repoMatches: string[], maxDepth = 2): string[] {
        if (currentDepth > maxDepth) {
            return repoMatches;
        }

        try {
            fs.readdirSync(dirPath, { withFileTypes: true}).filter((dirent) =>
                dirent.isDirectory()).
                forEach((childDir) => {
                    const childDirPath = path.join(dirPath, childDir.name);
                    if (childDir.name.toLowerCase() === repoName.toLowerCase() && fs.existsSync(path.join(childDirPath, '.git'))) {
                        // If the child directory matches the specified repo name and contains a git directory, add it to our matches list.
                        repoMatches.push(path.join(childDirPath));
                    }
                    this.findGitRepoInPath(repoName, childDirPath, currentDepth + 1, repoMatches, maxDepth);
                });
        } catch (ex) {
            // Ignore EPERM errors restricting read access to certain directories.
            // Sending telemetry is not necessary here as we simply no-op in this scenario.
        }

        return repoMatches;
    }

    /**
     * Presents a quick pick menu to allow the user to select the correct repository clone path when multiple enlistments are detected.
     * @param {string} repoName The name of the repository to open.
     * @param {string[]} repoMatches The list of repository paths matching the repository name.
     * @returns {Promise<string>} The selected repository path.
     */
    public static async handleMultipleRepoMatches(repoName: string, repoMatches: string[]): Promise<string> {
        // Note: Guaranteed to have repoMatches.length > 1 by the caller.
        // Prompt user to select the correct repo clone.
        const repoMatchesQuickPickItems: vscode.QuickPickItem[] = [];
        for (const repoMatch of repoMatches) {
            repoMatchesQuickPickItems.push({label: repoMatch});
        }

        // Show quick pick item asking for user to select tool to run.
        const selectedRepoMatch: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
            repoMatchesQuickPickItems,
            {
                canPickMany: false,
                placeHolder: `Multiple repository matches found, please select the desired repository for ${repoName}`
            }
        );

        // If the user doesn't select an option, default to the first match.
        return selectedRepoMatch?.label ?? repoMatches[0];
    }

    /**
     * Saves a repo mapping given repo name.
     * @param {string} repoName The repository name.
     * @param {vscode.Uri} repoUri The repository URI path.
     * @param {string | undefined} title The vulnerability title result identifier.
     * @param {string | undefined} commentThreadBody The comment thread body.
     * @param {string | undefined} commentThreadLabel The comment thread label.
     * @param {string | undefined} commentThreadName The comment thread name.
     * @param {number | undefined} openFileLineNumber The line number to open to for the open file scenario.
     * @param {string | undefined} openFileRelativePath The path to open to for the open file scenario.
     * @param {string | undefined} operationId UUID for URI-triggered run (currently only for S360, should eventually support OneClick as well.)
     * @param {UriAction} action The corresponding action to follow
     * @returns {Promise<void>} A promise indicating completion.
     */
    public static async saveRepoMapping(
        repoName: string,
        repoUri: vscode.Uri,
        title: string | undefined,
        commentThreadBody: string | undefined,
        commentThreadLabel: string | undefined,
        commentThreadName: string | undefined,
        openFileLineNumber: number | undefined,
        openFileRelativePath: string | undefined,
        operationId: string,
        action: UriAction
    ): Promise<void> {

        const repoMappingMetadata: RepoMappingMetadata = {
            action,
            commentThreadBody,
            commentThreadLabel,
            commentThreadName,
            openFileLineNumber,
            openFileRelativePath,
            operationId,
            repoPath: repoUri.fsPath,
            title
        };

        // If we received 'null' from the URI caller, we couldn't resolve the repo name.
        // Save the selected repo to the nullMappingKey so that we can run a scan on the selection.
        if (repoName === 'null') {
            // If we received 'null' for the repo name, flag that in our global context so that when the user selects a folder the scan will run automatically.
            await Extension.extensionContext.globalState.update(
                UriHandler.nullMappingKey,
                repoMappingMetadata
            );
        }

        // Save repo information to global state for future references.
        // Mark the repo for vulnerability run once new extension host activates.
        await Extension.extensionContext.globalState.update(
            repoName.toLowerCase(),
            repoMappingMetadata
        );

        // Additionally, in the case that the user selects a repository location whose name is renamed from the default repo name, set the run flag for the renamed repo key.
        // This allows us to map to the correct path given the default repo name, but know to run the Component Governance scan on the correct (renamed) workspace.
        // An example of this is if the user has a team repo named "myRepo", but their clone is named "myRepo2."
        // In this scenario, we would map "myRepo" to the correct path, but then know to run the scan on "myRepo2" rather than checking the "myRepo" key for run state.
        const repoNameFromPath: string = path.basename(repoUri.fsPath);
        if (repoName.toLowerCase() !== repoNameFromPath.toLowerCase()) {
            await Extension.extensionContext.globalState.update(
                repoNameFromPath.toLowerCase(),
                repoMappingMetadata
            );
        }
    }
}
