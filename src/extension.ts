/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import { ExtensionContext } from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { ExplorerController } from "./ExplorerController";
import { FileConverter } from "./FileConverter";
import { LogReader } from "./LogReader";
import { SVCodeActionProvider } from "./SVCodeActionProvider";
import { Utilities } from "./Utilities";
import { ResultsListController } from "./ResultsListController";
import { FileMapper } from "./FileMapper";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
export async function activate(context: ExtensionContext): Promise<void> {
    Utilities.initialize(context);
    FileConverter.initialize(context);

    const fileMapper: FileMapper = new FileMapper();
    context.subscriptions.push(fileMapper);

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
    const reader: LogReader = (new LogReader(fileMapper, diagnosticCollection));
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
