/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';

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

export interface Api {
    /**
     * Instructs the SARIF viewer to open log files.
     * @param sarifFiles The log files to open..
     * @param openLogFileArguments Parameters that control how the log files are opened.
     */
    openLogFiles(sarifFiles: vscode.Uri[], openLogFileArguments?: OpenLogFileArguments): Promise<void>;

    /**
     * Instructs the SARIF viewer to close log files.
     * @param sarifFiles The log files to close.
     */
    closeLogFiles(sarifFiles: vscode.Uri[]): Promise<void>;

    /**
     * Instructs the SARIF viewer to closs all log files.
     */
    closeAllLogFiles(): Promise<void>;
}
