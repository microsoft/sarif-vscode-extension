/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
nls.config({locale: process.env.VSCODE_NLS_CONFIG});

import { ExtensionContext } from "vscode";
import { CodeFlowCodeLensProvider } from "./codeFlowCodeLens";
import { CodeFlowDecorations } from "./codeFlowDecorations";
import { ExplorerController } from "./explorerController";
import { FileConverter } from "./fileConverter";
import { LogReader } from "./logReader";
import { SVCodeActionProvider } from "./svCodeActionProvider";
import { Utilities } from "./Utilities";
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
    const reader: LogReader = (new LogReader(diagnosticCollection));
    context.subscriptions.push(reader);

    // We do not need to block extension startup for reading any open documents.
    void reader.readAll();
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate(): void {
    // ToDo: rusty: Close html preview, unregister events, clear diagnostic collection
    Utilities.removeSarifViewerTempDirectory();
}
