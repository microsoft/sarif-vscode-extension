/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
nls.config({ locale: process.env.VSCODE_NLS_CONFIG });
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as vscode from "vscode";
import * as path from "path";
import { CodeFlowCodeLensProvider } from "./codeFlowCodeLens";
import { CodeFlowDecorations } from "./codeFlowDecorations";
import { ExplorerController } from "./explorerController";
import { FileConverter, UpgradeSarifOptions } from "./fileConverter";
import { LogReader, LogReaderResult } from "./logReader";
import { SVCodeActionProvider } from "./svCodeActionProvider";
import { Utilities } from "./utilities";
import { ResultsListController } from "./resultsListController";
import { FileMapper } from "./fileMapper";
import { SVDiagnosticCollection } from "./svDiagnosticCollection";
import { OpenLogArguments, Api } from "./api/sarifViewerApi";

// This is equivalent to "including" the generated javascript to get the code to run that sets the prototypes for the extension methods.
// If you don't do this... you crash using the extension methods.
import './utilities/stringUtilities';
import { ArtifactContentFileSystemProvider } from './artifactContentFileSystemProvider';

export function activate(context: vscode.ExtensionContext): Api {
    return new SarifExtension(context);
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate(): void {
    Utilities.removeSarifViewerTempDirectory();
}

/**
 * Used to control options when opening a SARIF file.
 */
interface OpenSarifFileOptions {
    /**
     * Indicates whether to open the file (if not already open) and display it to the user.
     */
    readonly openInTextEditor: boolean;

    /**
     * Indicates whether to close the original SARIF log file if an upgrade is performed.
     */
    readonly closeOriginalFileOnUpgrade: boolean;

    /**
     * Used by the API implementation to override the behavior of the
     * showing the explorer when there are no results.
     */
    readonly openViewerWhenNoResults?: boolean;

    /**
     * Controls the SARIF upgrade prompt when a log is opened
     * from an earlier schema. If defined, overrides user settings.
     */
    readonly upgradeSarifOptions?: UpgradeSarifOptions;
}

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
class SarifExtension implements Api {
    private readonly diagnosticCollection: SVDiagnosticCollection;
    private readonly explorerController: ExplorerController;
    private readonly logReader: LogReader;

    public constructor(context: vscode.ExtensionContext) {
        Utilities.initialize(context);
        FileConverter.initialize(context);

        context.subscriptions.push(FileMapper.InitializeFileMapper());

        this.diagnosticCollection = new SVDiagnosticCollection();
        context.subscriptions.push(this.diagnosticCollection);

        this.explorerController = new ExplorerController(context, this.diagnosticCollection);
        context.subscriptions.push(this.explorerController);

        const codeActionProvider: SVCodeActionProvider = new SVCodeActionProvider(this.diagnosticCollection);
        context.subscriptions.push(codeActionProvider);

        context.subscriptions.push(new ResultsListController(this.explorerController, codeActionProvider, this.diagnosticCollection));

        context.subscriptions.push(new CodeFlowCodeLensProvider(this.explorerController, this.diagnosticCollection));

        context.subscriptions.push(new CodeFlowDecorations(this.explorerController, this.diagnosticCollection));

        this.logReader = new LogReader();
        context.subscriptions.push(this.logReader);

        // Register our file system provider.
        context.subscriptions.push(new ArtifactContentFileSystemProvider());

        // Listen for new sarif files to open or close
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(this.onDocumentOpened.bind(this)));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(this.onDocumentClosed.bind(this)));

        // We do not need to block extension startup for reading any open documents.
        void this.readOpenedDocuments();
    }

    /**
     * When a sarif document opens we read it and sync to the list of issues to add it to the problems panel
     * @param doc document that was opened
     */
    private async onDocumentOpened(doc: vscode.TextDocument): Promise<void> {
        if (!doc.uri.isSarifFile()) {
            return;
        }

        await this.openSarifFile(doc.uri, { openInTextEditor: true, closeOriginalFileOnUpgrade: true });
    }

    /**
     * Enumerates open workspace files and parse them and places them into the diagnostic collection.
     * @param logReader The log reader that will be used to parse the results.
     * @param diagnosticCollection The diagnostic collection to add the results too.
     */
    private async readOpenedDocuments(): Promise<void> {
        // Spin through VSCode's documents and read any SARIF files that are opened.
        const urisToParse: vscode.Uri[] = vscode.workspace.textDocuments.filter((doc) => doc.uri.isSarifFile()).map((doc) => doc.uri);
        for (const uriToParse of urisToParse) {
            await this.openSarifFile(uriToParse, { openInTextEditor: true, closeOriginalFileOnUpgrade: true });
        }
    }

    private isSarifFileOpenInTextEditor(sarifFile: vscode.Uri): boolean {
        return vscode.window.visibleTextEditors.filter((textEditor) => textEditor.document.uri.toString() === sarifFile.toString()).length !== 0;
    }

    private async openSarifFileIfNotOpen(sarifFile: vscode.Uri): Promise<void> {
        if (this.isSarifFileOpenInTextEditor(sarifFile)) {
            return;
        }

        await vscode.commands.executeCommand('vscode.open', sarifFile, {
            preserveFocus: false,
            preview: false,
            viewColumn: vscode.ViewColumn.One,
        });
    }

    /**
     * Enumerates open workspace files and parse them and places them into the diagnostic collection.
     * @param logReader The log reader that will be used to parse the results.
     * @param diagnosticCollection The diagnostic collection to add the results too.
     * @param options Options controlling the upgrade prompt if a SARIF file is at an earlier schema version.
     */
    private async openSarifFile(sarifFile: vscode.Uri, options: OpenSarifFileOptions): Promise<void> {
        if (!sarifFile.isSarifFile()) {
            return;
        }

        // Pass on the desire to show the explorer view when no results on to the explorer controller.
        this.explorerController.openViewerWhenNoResults = options.openViewerWhenNoResults;

        let logReaderResult: LogReaderResult = await this.logReader.read(sarifFile);

        // No upgraded need. Results are ready.
        if (logReaderResult.upgradeCheckInformation.upgradedNeeded === 'No') {
            this.diagnosticCollection.addParseResults(logReaderResult.parseResults);
            if (options.openInTextEditor) {
                await this.openSarifFileIfNotOpen(sarifFile);
            }
            return;
        }

        if (logReaderResult.upgradeCheckInformation.upgradedNeeded === 'Schema Undefined') {
            if (!logReaderResult.upgradeCheckInformation.parsedSchemaVersion) {
                await vscode.window.showErrorMessage(
                    localize('logReader.schemaNotDefined', "Sarif Viewer: Cannot display results for '{0}' because the schema was not defined.",
                        path.basename(sarifFile.fsPath)));
            }
            return;
        }

        if (logReaderResult.upgradeCheckInformation.upgradedNeeded === 'Schema Unknown' && logReaderResult.sarifLog) {
            await vscode.window.showErrorMessage(localize(
                'converterTool.UpgradedErrorMessage',
                "Sarif version '{0}'(schema '{1}') is not yet supported by the Viewer. Make sure you have the latest extension version and check https://github.com/Microsoft/sarif-vscode-extension for future support.",
                logReaderResult.sarifLog.version, logReaderResult.sarifLog.$schema));
            return;
        }

        if (logReaderResult.upgradeCheckInformation.upgradedNeeded === 'Yes') {
            const upgradedUri: vscode.Uri | undefined = await FileConverter.upgradeSarif(sarifFile, logReaderResult.upgradeCheckInformation.parsedVersion, logReaderResult.upgradeCheckInformation.parsedSchemaVersion, options.upgradeSarifOptions);
            if (!upgradedUri) {
                return;
            }

            if (!options.openInTextEditor) {
                logReaderResult = await this.logReader.read(upgradedUri);

                this.diagnosticCollection.addParseResults(logReaderResult.parseResults);
                return;
            }

            if (options.closeOriginalFileOnUpgrade) {
                const activeTextEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

                if (activeTextEditor && activeTextEditor.document.fileName === sarifFile.fsPath) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
            }

            await this.openSarifFileIfNotOpen(upgradedUri);
        }
    }

    /**
     * When a sarif document closes we need to clear all of the list of issues and reread the open sarif docs
     * Can't selectively remove issues because the issues don't have a link back to the sarif file it came from
     * @param doc document that was closed
     */
    private onDocumentClosed(doc: vscode.TextDocument): void {
        if (doc.uri.isSarifFile()) {
            this.diagnosticCollection.removeRuns([doc.uri]);
        }
    }

    /**
     * @inheritdoc
     */
    public async openLogs(logs: vscode.Uri[], openLogFileArguments?: OpenLogArguments): Promise<void> {
        for (const log of logs) {
            this.explorerController.openViewerWhenNoResults = openLogFileArguments?.openViewerWhenNoResults;

            await this.openSarifFile(log, {
                openViewerWhenNoResults: openLogFileArguments?.openViewerWhenNoResults,
                closeOriginalFileOnUpgrade: true,
                openInTextEditor: false,
                upgradeSarifOptions: (openLogFileArguments?.promptForUpgrade !== undefined) ? (openLogFileArguments?.promptForUpgrade ? 'Prompt' : 'Temporary') : undefined
            });
        }
    }

    /**
     * @inheritdoc
     */
    public async closeLogs(logs: vscode.Uri[]): Promise<void> {
        for (const log of logs) {
            this.diagnosticCollection.removeRuns([log]);
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
