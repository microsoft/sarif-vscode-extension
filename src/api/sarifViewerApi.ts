/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';

/**
 * Options used when the SARIF viewer is opening logs.
 */
export interface OpenLogArguments {
    /**
     * Indicates whether to prompt the user when the
     * SARIF log schema is needs to be upgraded to the latest one schema version.
     * The default is true.
     */
    readonly promptUserForUpgrade?: boolean;

    /**
     * Indicates whether to open SARIF logs inside the VSCode editor.
     * The default is true.
     */
    readonly openInEditor?: boolean;

    /**
     * Indicates whether the SARIF viewer should open when there are no results in the logs to display.
     * The default is true.
     */
    readonly openViewerOnNoResults?: boolean;
}

/**
 * API exposed by the SARIF viewer extension.
 */
export interface Api {
    /**
     * Instructs the SARIF viewer to open logs.
     * @param logs The logs to open.
     * @param openLogArguments Parameters that control how the logs are opened.
     */
    openLogs(logs: vscode.Uri[], openLogArguments?: OpenLogArguments): Promise<void>;

    /**
     * Instructs the SARIF viewer to close logs.
     * @param logs The log to close.
     */
    closeLogs(logs: vscode.Uri[]): Promise<void>;

    /**
     * Instructs the SARIF viewer to close all logs.
     */
    closeAllLogs(): Promise<void>;
}
