/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
nls.config({locale: process.env.VSCODE_NLS_CONFIG});
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
import { Api } from "./api/sarifViewerApi";

// This is equivalent to "including" the generated javascript to get the code to run that sets the prototypes for the extension methods.
// If you don't do this... you crash using the extension methods.
import './utilities/stringUtilities';
import { ApiImpl } from './utilities/apiImpl';
import { ArtifactContentFileSystemProvider } from './artifactContentFileSystemProvider';

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
export function activate(context: vscode.ExtensionContext): Api {
    Utilities.initialize(context);
    FileConverter.initialize(context);

    context.subscriptions.push(FileMapper.InitializeFileMapper());

    const diagnosticCollection: SVDiagnosticCollection = new SVDiagnosticCollection();
    context.subscriptions.push(diagnosticCollection);

    const explorerController: ExplorerController = new ExplorerController(context, diagnosticCollection);
    context.subscriptions.push(explorerController);

    const codeActionProvider: SVCodeActionProvider = new SVCodeActionProvider(diagnosticCollection);
    context.subscriptions.push(codeActionProvider);

    context.subscriptions.push(new ResultsListController(explorerController, codeActionProvider, diagnosticCollection));

    context.subscriptions.push(new CodeFlowCodeLensProvider(explorerController, diagnosticCollection));

    context.subscriptions.push(new CodeFlowDecorations(explorerController, diagnosticCollection));

    const logReader: LogReader = new LogReader();
    context.subscriptions.push(logReader);

    // Listen for new sarif files to open or close
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (textDocument) => {
        await onDocumentOpened(textDocument, logReader, diagnosticCollection);
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((textDocument) => {
        onDocumentClosed(textDocument, diagnosticCollection);
    }));

    context.subscriptions.push(new ArtifactContentFileSystemProvider());

    // We do not need to block extension startup for reading any open documents.
    void readOpenedDocuments(logReader, diagnosticCollection);

    return new ApiImpl(logReader, diagnosticCollection);
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate(): void {
    // ToDo: rusty: Close html preview, unregister events, clear diagnostic collection
    Utilities.removeSarifViewerTempDirectory();
}

/**
 * When a sarif document opens we read it and sync to the list of issues to add it to the problems panel
 * @param doc document that was opened
 */
async function onDocumentOpened(doc: vscode.TextDocument, logReader: LogReader, diagnosticCollection: SVDiagnosticCollection): Promise<void> {
    if (!doc.uri.isSarifFile()) {
        return;
    }

    await openSarifFile(doc.uri, logReader, diagnosticCollection, { promptUserForUpgrade: true, openInTextEditor: true, closeOriginalFileOnUpgrade: true });
}

/**
 * Enumerates open workspace files and parse them and places them into the diagnostic collection.
 * @param logReader The log reader that will be used to parse the results.
 * @param diagnosticCollection The diagnostic collection to add the results too.
 */
async function readOpenedDocuments(logReader: LogReader, diagnosticCollection: SVDiagnosticCollection): Promise<void> {
    // Spin through VSCode's documents and read any SARIF files that are opened.
    const urisToParse: vscode.Uri[] = vscode.workspace.textDocuments.filter((doc) => doc.uri.isSarifFile()).map((doc) => doc.uri);
    for (const uriToParse of urisToParse) {
        await openSarifFile(uriToParse, logReader, diagnosticCollection, { promptUserForUpgrade: true, openInTextEditor: true, closeOriginalFileOnUpgrade: true });
    }
}

/**
 * Used to control options when opening a SARIF file.
 */
interface OpenSarifFileOptions extends UpgradeSarifOptions {
    /**
     * Indicates whether to open the file (if not already open) and display it to the user.
     */
    openInTextEditor: boolean;

    /**
     * Indicates whether to close the original SARIF log file if an upgrade is performed.
     */
    closeOriginalFileOnUpgrade: boolean;
}

function isSarifFileOpenInTextEditor(sarifFile: vscode.Uri): boolean {
    return vscode.window.visibleTextEditors.filter((textEditor) => textEditor.document.uri.toString() === sarifFile.toString()).length !== 0;
}

async function openSarifFileIfNotOpen(sarifFile: vscode.Uri): Promise<void> {
    if (isSarifFileOpenInTextEditor(sarifFile))  {
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
export async function openSarifFile(sarifFile: vscode.Uri, logReader: LogReader, diagnosticCollection: SVDiagnosticCollection, options: OpenSarifFileOptions): Promise<void> {
    if (!sarifFile.isSarifFile()) {
        return;
    }
    let logReaderResult: LogReaderResult = await logReader.read(sarifFile);

    // No upgraded need. Results are ready.
    if (logReaderResult.upgradeCheckInformation.upgradedNeeded === 'No') {
        diagnosticCollection.addParseResults(logReaderResult.parseResults);
        if (options.openInTextEditor) {
            await openSarifFileIfNotOpen(sarifFile);
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
        const upgradedUri: vscode.Uri | undefined = await FileConverter.upgradeSarif(sarifFile, logReaderResult.upgradeCheckInformation.parsedVersion, logReaderResult.upgradeCheckInformation.parsedSchemaVersion, options);
        if (!upgradedUri) {
            return;
        }

        if (!options.openInTextEditor) {
            logReaderResult = await logReader.read(upgradedUri);

            diagnosticCollection.addParseResults(logReaderResult.parseResults);
            return;
        }

        if (options.closeOriginalFileOnUpgrade) {
            const activeTextEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

            if (activeTextEditor && activeTextEditor.document.fileName === sarifFile.fsPath) {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
        }

        await openSarifFileIfNotOpen(upgradedUri);
    }
}

/**
 * When a sarif document closes we need to clear all of the list of issues and reread the open sarif docs
 * Can't selectively remove issues because the issues don't have a link back to the sarif file it came from
 * @param doc document that was closed
 */
function onDocumentClosed(doc: vscode.TextDocument, diagnosticCollection: SVDiagnosticCollection): void {
    if (doc.uri.isSarifFile()) {
        diagnosticCollection.removeRuns([doc.uri]);
    }
}
