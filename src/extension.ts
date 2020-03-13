/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import { commands, ExtensionContext } from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { ExplorerController } from "./ExplorerController";
import { FileConverter } from "./FileConverter";
import { LogReader } from "./LogReader";
import { SVCodeActionProvider } from "./SVCodeActionProvider";
import { Utilities } from "./Utilities";
import { ResultsListController } from "./ResultsListController";

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
export async function activate(context: ExtensionContext): Promise<void> {
    Utilities.initialize(context);
    FileConverter.initialize(context);

    const explorerController: ExplorerController = new ExplorerController(context);
    context.subscriptions.push(explorerController);

    const codeActionProvider: SVCodeActionProvider = new SVCodeActionProvider(explorerController, explorerController.diagnosticCollection);
    context.subscriptions.push(codeActionProvider);

    context.subscriptions.push(new ResultsListController(explorerController, codeActionProvider, explorerController.diagnosticCollection));

    context.subscriptions.push(new SVCodeActionProvider(explorerController, explorerController.diagnosticCollection));

    context.subscriptions.push(new CodeFlowCodeLensProvider(explorerController));

    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectNextCFStepCommand, CodeFlowDecorations.selectNextCFStep),
    );
    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectPrevCFStepCommand, CodeFlowDecorations.selectPrevCFStep),
    );

    // Read the initial set of open SARIF files
    const reader: LogReader = LogReader.Instance;
    context.subscriptions.push(reader);

    // TODO: Need to add "Start floating promise" utility function here
    await reader.readAll();
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate(): void {
    // ToDo: rusty: Close html preview, unregister events, clear diagnostic collection
    Utilities.removeSarifViewerTempDirectory();
}
