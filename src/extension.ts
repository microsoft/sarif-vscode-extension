// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { commands, ExtensionContext, Uri } from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { ExplorerController } from "./ExplorerController";
import { FileMapper } from "./FileMapper";
import { LogReader } from "./LogReader";
import { SVCodeActionProvider } from "./SVCodeActionProvider";

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
export function activate(context: ExtensionContext) {

    // Create the launch Explorer command
    context.subscriptions.push(
        commands.registerCommand(ExplorerController.ExplorerLaunchCommand, () => {
            ExplorerController.Instance.launchWebView();
        }));

    context.subscriptions.push(
        commands.registerCommand(ExplorerController.SendCFSelectionToExplorerCommand, (id: string) => {
            CodeFlowDecorations.updateCodeFlowSelection(undefined, id);
            ExplorerController.Instance.setSelectedCodeFlow(id);
        }));

    // Create File mapper command
    context.subscriptions.push(
        commands.registerCommand(FileMapper.MapCommand, (file: string) => {
            FileMapper.Instance.getUserToChooseFile(Uri.parse(file));
        }));

    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectNextCFStepCommand, CodeFlowDecorations.selectNextCFStep),
    );
    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectPrevCFStepCommand, CodeFlowDecorations.selectPrevCFStep),
    );

    // Instantiate the providers and filemaper which will register their listeners and register their disposables
    context.subscriptions.push(SVCodeActionProvider.Instance);
    context.subscriptions.push(CodeFlowCodeLensProvider.Instance);
    context.subscriptions.push(FileMapper.Instance);

    // Read the initial set of open SARIF files
    const reader = LogReader.Instance;
    context.subscriptions.push(reader);
    reader.readAll();
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate() {
    // ToDo: rusty: Close html preview, unregister events, clear diagnostic collection
    return undefined;
}
