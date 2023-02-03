// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { UriHandlerUtilities } from '../uriHandler/uriHandlerUtilities';
import { UriHelpViewUtilities } from '../uriHandler/uriHelpViewUtilities';
import { Extension } from '../extension';
import { UriHandler } from '../uriHandler/uriHandler';
import { UriMetadata } from '../uriHandler/uriHandlerInterfaces';
import fetch, { Response } from 'node-fetch';

/**
 * Extension utilities.
 */
export class FileUtilities {

    /**
     * Gets the directory name given a path.
     * @param {string} directoryPath The directory path.
     * @returns {string} The directory name.
     */
    public static getPathDirectoryName(directoryPath: string): string {
        // eslint-disable-next-line require-unicode-regexp
        const fixedDirectoryPath: string = directoryPath.replace(/\//g, '\\');
        const lastSlashIndex: number = fixedDirectoryPath.lastIndexOf('\\');
        const directoryName: string = fixedDirectoryPath.substring(lastSlashIndex + 1);
        return directoryName;
    }

    /**
     * Gets the workspace folder.
     * @returns {string | undefined} The workspace folder path or undefined.
     */
    public static getWorkspaceFolder(): string | undefined {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }

        return undefined;
    }

    /**
     * Recursively retrieves all files and extension names given a directory path.
     * @param {string} dirPath The directory path.
     * @param {number} currentRecursionDepth The current recursion depth. This is used to prevent overreading in case of a large directory.
     * @param {string[]} foundFiles The currently found files.
     * @param {number} maxRecursionDepth The max number of recursive operations to perform. Default is 20.
     * @returns {GitRemoteOriginUrlProps} The git remote origin URL properties.
     */
    public static getAllFileNames(dirPath: string, currentRecursionDepth: number, foundFiles?: string[], maxRecursionDepth = 20): string[] {
        if (currentRecursionDepth >= maxRecursionDepth) {
            return [];
        }

        const files: string[] = fs.readdirSync(dirPath);
        let arrayOfFiles: string[] = foundFiles || [];

        for (const file of files) {
            if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
                arrayOfFiles = FileUtilities.getAllFileNames(path.join(dirPath, file), currentRecursionDepth++, arrayOfFiles);
            } else {
                arrayOfFiles.push(path.join(dirPath, file));
            }
        }

        return arrayOfFiles;
    }

    // public static async validateAndSaveFIle (fileURL: string, dest: string, cb = null) {
    //     const fileName = fileURL;

    //     let analysesResponse: Response | undefined;
    //     try {
    //         // Useful for debugging the progress indicator: await new Promise(resolve => setTimeout(resolve, 2000));
    //         analysesResponse = await fetch(fileURL);
    //     } catch (error) {
    //         // Expected error value if the network is disabled.
    //         // {
    //         //     "message": "request to https://api.github.com/repos/microsoft/sarif-vscode-extension/code-scanning/analyses?ref=refs/heads/main failed, reason: getaddrinfo ENOTFOUND api.github.com",
    //         //     "type": "system",
    //         //     "errno": "ENOTFOUND",
    //         //     "code": "ENOTFOUND"
    //         // }
    //         // updateMessage('Network error. Refresh to try again.');
    //     }
    //     if (!analysesResponse) {
    //         return undefined;
    //     }
    //     if (analysesResponse.status === 403) {
    //         return undefined;
    //     }

    // }

    public static async validateAndSaveFile2(fileURL: string, dest: vscode.Uri) {
        const releasesResponse = await fetch(fileURL);
        if (releasesResponse.status !== 200) return false;
        // const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri; // TODO: Handle multiple workspaces.
        const urlParsed = url.parse(fileURL);
        const uri = urlParsed!.pathname!.split('/');
        const filename = (uri[uri.length - 1].match(/(\w*\.?-?)+/))![0];
        // const workspaceSarifUri = vscode.Uri.joinPath(workspaceUri!, '.sarif', filename);
        const workspaceSarifUri = vscode.Uri.joinPath(dest, '.sarif', filename);
        FileUtilities.ensureDirectoryExistence(workspaceSarifUri.fsPath);
        const file = fs.createWriteStream(workspaceSarifUri.fsPath);

        await new Promise((resolve, reject) => {
            releasesResponse.body.pipe(file);
            releasesResponse.body.on('error', reject);
            file.on('finish', resolve);
        });

        return true;
    }


    public static validateAndSaveFIle(fileURL: string, dest: string, repoName: string, repositoryUri: vscode.Uri) {
        const timeout = 10000,
            urlParsed = url.parse(fileURL),
            uri = urlParsed!.pathname!.split('/');
        let req,
            filename = (uri[uri.length - 1].match(/(\w*\.?-?)+/))![0];

        if (urlParsed.protocol === null) {
            fileURL = 'http://' + fileURL;
        }

        // eslint-disable-next-line prefer-const
        req = (urlParsed.protocol === 'https:') ? https : http;

        const request = req.get(fileURL, function (response) {

            // Make sure extension is present (mostly for images)
            if (filename.indexOf('.') < 0) {
                const contentType = response.headers['content-type'];
                filename += `.${contentType!.split('/')[1]}`;
            }
            const destUri = vscode.Uri.file(dest);
            const targetPath = vscode.Uri.joinPath(destUri, filename);

            if (response.statusCode === 200) {
                // const file = fs.createWriteStream(targetPath.fsPath);
                // response.pipe(file);
                // vscode.commands.executeCommand('vscode.open', targetPath);

                const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri; // TODO: Handle multiple workspaces.
                const workspaceSarifUri = vscode.Uri.joinPath(workspaceUri!, '.sarif', filename);
                FileUtilities.ensureDirectoryExistence(workspaceSarifUri.fsPath);
                const file = fs.createWriteStream(workspaceSarifUri.fsPath);
                response.pipe(file);

                // api.openLogs(await workspace.findFiles('.sarif/**.sarif'), {});
                // vscode.commands.executeCommand('sarif.loadFile', targetPath);

                // FileUtilities.loadRepo(fileURL, dest, repoName, repositoryUri);

            } else {
                vscode.window.showErrorMessage(`Downloading ${fileURL} failed`);
            }

            response.on('end', function () {
                vscode.window.showInformationMessage(`File "${filename}" downloaded successfully.`);
            });

            request.setTimeout(timeout, function () {
                request.abort();
            });

        }).on('error', function (e) {
            vscode.window.showErrorMessage(`Downloading ${fileURL} failed! Please make sure URL is valid.`);
        });
    }

    public static async loadRepo(fileURL: string, dest: string, repoName: string, repositoryUri: vscode.Uri) {
        const repoUri: vscode.Uri | undefined = await UriHandlerUtilities.tryGetRepoMapping(repoName);

        if (repoUri) {
            // Save Repo Mapping
            await UriHandlerUtilities.saveRepoMapping(
                repoName,
                repoUri,
                undefined,
                'uriMetadata.operationId'
            );
            // await vscode.commands.executeCommand('vscode.openFolder', repoUri);
            // await vscode.workspace.updateWorkspaceFolders(0, 0, { uri: repoUri });
            await UriHandlerUtilities.openRepo(fileURL, repoName, repoUri, 'uriMetadata.operationId');
        }
        else {
            await UriHelpViewUtilities.showUriHelpView(true);
            const cgUriMetadata: UriMetadata = {
                operationId: 'uriMetadata.operationId',
                organization: 'undefined',
                project: 'undefined',
                repoName: repoName ?? 'undefined',
                repoUri: repositoryUri,
                sarifUri: fileURL,
                title: 'undefined'
            };
            await Extension.extensionContext.globalState.update(
                UriHandler.uriMetadataKey,
                cgUriMetadata
            );
            // const repoUri: vscode.Uri | undefined = await UriHandlerUtilities.cloneRepo(
            //     repoName,
            //     'mseng',
            //     '1ES'
            // );

            // await vscode.commands.executeCommand(
            //     'git.clone',
            //     `https://github.com/shaopeng-gh/BinBuild`,
            //     'C:\\GH'
            // );
        }
        // FileUtilities.validateAndSaveFIle(fileURL, dest, repoName, repositoryUri);
    }

    public static ensureDirectoryExistence(filePath: string) {
        const dirname = path.dirname(filePath);
        if (fs.existsSync(dirname)) {
            return;
        }
        FileUtilities.ensureDirectoryExistence(dirname);
        fs.mkdirSync(dirname);
    }
}
