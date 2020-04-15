/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarifApi from "./../api/sarifViewerApi";
import * as vscode from "vscode";
import { LogReader } from "../logReader";
import { SVDiagnosticCollection } from "../svDiagnosticCollection";
import { openSarifFile } from "../extension";

export class ApiImpl implements sarifApi.Api {
    /**
     * Constructs an instance of the API given out by the extension.
     * @param logReader An instance of the log reader to use for parsing log files.
     * @param diagnosticCollection The diagnostic collection that holds the results.
     */
    public constructor(private readonly logReader: LogReader, private readonly diagnosticCollection: SVDiagnosticCollection) {
    }

    /**
     * @inheritdoc
     */
    public async openLogs(sarifFiles: vscode.Uri[], openLogFileArguments?: sarifApi.OpenLogArguments): Promise<void> {
        for (const sarifUri of sarifFiles) {
            await openSarifFile(sarifUri, this.logReader, this.diagnosticCollection, {
                closeOriginalFileOnUpgrade: true,
                openInTextEditor: false,
                promptUserForUpgrade: openLogFileArguments?.promptUserForUpgrade ?? true
            });
        }
    }

    /**
     * @inheritdoc
     */
    public async closeLogs(sarifFiles: vscode.Uri[]): Promise<void> {
        for (const sarifUri of sarifFiles) {
            this.diagnosticCollection.removeRuns(sarifUri);
        }

        return;
    }

    /**
     * @inheritdoc
     */
    public async closeAllLogs(): Promise<void> {
        this.diagnosticCollection.removeAllRuns();

        return;
    }
}
