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
    readonly promptForUpgrade?: boolean;

    /**
     * Indicates whether the SARIF viewer should open when there are no results in the logs to display.
     * The default is true.
     */
    readonly openViewerWhenNoResults?: boolean;

    /**
     * A set of root paths to use for mapping remote artifact locations.
     * The paths are used only for this instance of the extension.
     * They are not persisted in the user settings.
     */
    readonly localRootPaths?: vscode.Uri[];
}

/**
 * API exposed by the SARIF viewer extension.
 */
export interface Api {
    /**
     * Opens logs.
     * @param logs The logs to open.
     * @param openLogArguments Parameters that control how the logs are opened.
     * @param cancellationToken Token used to cancel the open log request.
     */
    openLogs(logs: vscode.Uri[], openLogArguments?: OpenLogArguments, cancellationToken?: vscode.CancellationToken): Promise<void>;

    /**
     * Closes logs.
     * @param logs The log to close.
     */
    closeLogs(logs: vscode.Uri[]): Promise<void>;

    /**
     * Closes all logs.
     */
    closeAllLogs(): Promise<void>;

    /**
     * A set of root paths to use for mapping remote artifact locations.
     * The paths are used only for this instance of the extension.
     * They are not persisted in the user settings.
     */
    rootPaths: vscode.Uri[];
}
