/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
nls.config({locale: process.env.VSCODE_NLS_CONFIG});

import * as vscode from "vscode";
import { CodeFlowCodeLensProvider } from "./codeFlowCodeLens";
import { CodeFlowDecorations } from "./codeFlowDecorations";
import { ExplorerController } from "./explorerController";
import { FileConverter } from "./fileConverter";
import { LogReader, ReadResult } from "./logReader";
import { SVCodeActionProvider } from "./svCodeActionProvider";
import { Utilities } from "./utilities";
import { ResultsListController } from "./resultsListController";
import { FileMapper } from "./fileMapper";
import { SVDiagnosticCollection } from "./svDiagnosticCollection";

// This is equiavelnt to "including" the generated javscript to get the code to run that sets the prototypes for the extension methods.
// If you don't do this... you crash using the extension methods.
import './utilities/stringUtilities';

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
export function activate(context: ExtensionContext): void {
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

    // Read the initial set of open SARIF files
    const reader: LogReader = ();
    context.subscriptions.push(reader);

    // Listen for new sarif files to open or close
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (textDocument) => {
        await onDocumentOpened(textDocument, reader, diagnosticCollection);
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((textDocument) => {
        onDocumentClosed(textDocument, diagnosticCollection);
    }));

    // We do not need to block extension startup for reading any open documents.
    void readOpenedDocuments(reader, diagnosticCollection);
}

/**
 * When a sarif document opens we read it and sync to the list of issues to add it to the problems panel
 * @param doc document that was opened
 */
async function onDocumentOpened(doc: vscode.TextDocument, logReader: LogReader, diagnosticCollection: SVDiagnosticCollection): Promise<void> {
    if (!doc.uri.isFile() || !Utilities.isSarifFile(doc)) {
        return;
    }

    const readResults: ReadResult[] = await logReader.read([doc.uri]);
    diagnosticCollection.addReadResults(readResults, {supressEventsDuringAdd: true, synchronizeUI: true});
}

/**
 * Enumerates open workspace files and parse them and places them into the diagnostic collection.
 * @param logReader The log reader that will be used to parse the results.
 * @param diagnosticCollection The diagnostic collection to add the results too.
 */
async function readOpenedDocuments(logReader: LogReader, diagnosticCollection: SVDiagnosticCollection): Promise<void> {
    // Spin through VSCode's documents and read any SARIF files that are opened.
    const urisToParse: vscode.Uri[] = vscode.workspace.textDocuments.filter((doc) => Utilities.isSarifFile(doc)).map((doc) => doc.uri);
    const readResults: ReadResult[] = await logReader.read(urisToParse);
    diagnosticCollection.addReadResults(readResults, {supressEventsDuringAdd: true, synchronizeUI: true});
}

/**
 * When a sarif document closes we need to clear all of the list of issues and reread the open sarif docs
 * Can't selectivly remove issues becuase the issues don't have a link back to the sarif file it came from
 * @param doc document that was closed
 */
function onDocumentClosed(doc: vscode.TextDocument, diagnosticCollection: SVDiagnosticCollection): void {
    if (Utilities.isSarifFile(doc)) {
        diagnosticCollection.removeRuns(doc.fileName);
    }
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate(): void {
    // ToDo: rusty: Close html preview, unregister events, clear diagnostic collection
    Utilities.removeSarifViewerTempDirectory();
}
