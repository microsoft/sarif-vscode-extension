// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

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
}
