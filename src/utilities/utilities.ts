// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Extension utilities.
 */
export class Utilities {

    /**
     * Returns an awaitable promise for setTimeout.
     * @param {number} ms The amount of milleseconds to delay.
     * @returns {object} The delay promise.
     */
    public static delay(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
        });
    }

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
     * Determines if a string contains an element in an array of strings.
     * @param {string} str The string to search within.
     * @param {string[]} arr The array of strings.
     * @param {boolean} caseSensitive Determines case-sensitive compare. Default is true.
     * @returns {boolean} A value indicating whether the string contains an array element.
     */
    public static stringContainsArrayElement(str: string, arr: string[], caseSensitive = true): boolean {
        if (!caseSensitive) {
            str = str.toLowerCase();
            arr = arr.map((element) =>
                element.toLowerCase());
        }

        const contains: boolean = arr.some((element) => {
            if (str.indexOf(element) >= 0) {
                return true;
            }

            return false;
        });

        return contains;
    }

    /**
     * Determines if a string ends with an element in an array of strings.
     * @param {string} str The string to search within.
     * @param {string[]} arr The array of strings.
     * @param {boolean} caseSensitive Determines case-sensitive compare. Default is false.
     * @returns {boolean} A value indicating whether the string contains an array element.
     */
    public static endsWithArrayElement(str: string, arr: string[], caseSensitive = true): boolean {
        if (!caseSensitive) {
            str = str.toLowerCase();
            arr = arr.map((element) =>
                element.toLowerCase());
        }

        const contains: boolean = arr.some((element) => {
            if (str.endsWith(element)) {
                return true;
            }

            return false;
        });

        return contains;
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
                arrayOfFiles = Utilities.getAllFileNames(path.join(dirPath, file), currentRecursionDepth++, arrayOfFiles);
            } else {
                arrayOfFiles.push(path.join(dirPath, file));
            }
        }

        return arrayOfFiles;
    }
}
