// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { commands, ExtensionContext } from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { ExplorerController } from "./ExplorerController";
import { FileConverter } from "./FileConverter";
import { FileMapper } from "./FileMapper";
import { LogReader } from "./LogReader";
import { SVCodeActionProvider } from "./SVCodeActionProvider";
import { Utilities } from "./Utilities";

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
export function activate(context: ExtensionContext) {
    // Create the launch Explorer command
    context.subscriptions.push(
        commands.registerCommand(ExplorerController.ExplorerLaunchCommand, () => {
            ExplorerController.Instance.createWebview();
        }));

    context.subscriptions.push(
        commands.registerCommand(ExplorerController.SendCFSelectionToExplorerCommand, (id: string) => {
            CodeFlowDecorations.updateCodeFlowSelection(id);
            ExplorerController.Instance.setSelectedCodeFlow(id);
        }));

    // Create File mapper command
    context.subscriptions.push(
        commands.registerCommand(FileMapper.MapCommand, (fileLocation: sarif.ArtifactLocation, runId: number) => {
            const uriBase = Utilities.getUriBase(fileLocation, runId);
            const uri = Utilities.combineUriWithUriBase(fileLocation.uri, uriBase);
            FileMapper.Instance.getUserToChooseFile(uri, uriBase);
        }));

    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectNextCFStepCommand, CodeFlowDecorations.selectNextCFStep),
    );
    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectPrevCFStepCommand, CodeFlowDecorations.selectPrevCFStep),
    );

    context.subscriptions.push(
        commands.registerCommand(FileConverter.ConvertCommand, FileConverter.selectConverter),
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
    Utilities.removeSarifViewerTempDirectory();
    return undefined;
}
