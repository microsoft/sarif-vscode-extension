/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

 import * as sarif from "sarif";
import { commands, ExtensionContext, Uri } from "vscode";
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
export async function activate(context: ExtensionContext): Promise<void> {
    // Create the launch Explorer command
    context.subscriptions.push(
        commands.registerCommand(ExplorerController.ExplorerLaunchCommand, () => {
            ExplorerController.Instance.createWebview();
        }));

    context.subscriptions.push(
        commands.registerCommand(ExplorerController.SendCFSelectionToExplorerCommand, SendCFSelectionToExplorerCommand));

    // Create File mapper command
    context.subscriptions.push(commands.registerCommand(FileMapper.MapCommand, mapFileCommand));

    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectNextCFStepCommand, CodeFlowDecorations.selectNextCFStep),
    );
    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectPrevCFStepCommand, CodeFlowDecorations.selectPrevCFStep),
    );

    FileConverter.initializeFileConverter(context);

    // Instantiate the providers and file mapper which will register their listeners and register their disposables
    context.subscriptions.push(SVCodeActionProvider.Instance);
    context.subscriptions.push(CodeFlowCodeLensProvider.Instance);
    context.subscriptions.push(FileMapper.Instance);

    // Read the initial set of open SARIF files
    const reader: LogReader = LogReader.Instance;
    context.subscriptions.push(reader);

    // TODO: Need to add "Start floating promise" utility function here
    await reader.readAll();
}

async function SendCFSelectionToExplorerCommand(id: string): Promise<void> {
    await CodeFlowDecorations.updateCodeFlowSelection(id);
    ExplorerController.Instance.setSelectedCodeFlow(id);
}

function mapFileCommand(fileLocation: sarif.ArtifactLocation, runId: number): Promise<void>  {
    const uriBase: string | undefined = Utilities.getUriBase(fileLocation, runId);
    if (uriBase && fileLocation.uri) {
        const uri: Uri  = Utilities.combineUriWithUriBase(fileLocation.uri, uriBase);
        return FileMapper.Instance.getUserToChooseFile(uri, uriBase);
    }

    return Promise.resolve();
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate(): void {
    // ToDo: rusty: Close html preview, unregister events, clear diagnostic collection
    Utilities.removeSarifViewerTempDirectory();
}
