/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';

/**
 * The expected arguments for the @see openLogFileCommand.
 */
export interface OpenLogFileArguments {
    /**
     * The array of SARIF log files to open. The log file URIs must be of scheme 'file' and be valid SARIF JSON files.
     */
    readonly sarifFiles: vscode.Uri[];

    /**
     * Specifies options indicating whether to prompt the user when the
     * SARIF log file shcmea is needs to be ugpraded to the latest one.
     * If not specified, the user will be prompted. (Default is true).
     */
    readonly promptUserForUpgrade?: boolean;

    /**
     * Indicates whether to open the files (if not already open) and display it to the user.
     * If not specified, the files will be displayed. (Default is true).
     */
    readonly openInTextEditor?: boolean;

    /**
     * Indicates whether the SARIF viewer should upen when there are no results to display.
     * If not specificm, the viewer will be displayed. (Default is true).
     */
    readonly openViewerOnNoResults?: boolean;
}

/**
 * The command the SARIF extension exposes to open SARIF log files.
 * The expected arguments are of type @see OpenLogFileArguments
 */
export const openLogFilesCommand: string = 'extension.sarif.openLogFiles';

/**
 * The expected arguments for the @see closeLogFileCommand.
 */
export interface CloseLogFileArguments {
    /**
     * The array of SARIF log files to close.
     */
    readonly sarifFiles: vscode.Uri[];
}

/**
 * The command the SARIF extension exposes to open SARIF log files.
 * The expected arguments are of type @see CloseLogFileArguments
 */
export const closeLogFilesCommand: string = 'extension.sarif.closeLogFiles';
