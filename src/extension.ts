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
import { ResultsListController } from "./ResultsListController";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

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

    const diagnosticCollection: SVDiagnosticCollection = new SVDiagnosticCollection(explorerController);
    context.subscriptions.push(diagnosticCollection);

    const codeActionProvider: SVCodeActionProvider = new SVCodeActionProvider(explorerController, diagnosticCollection);
    context.subscriptions.push(codeActionProvider);

    context.subscriptions.push(new ResultsListController(explorerController, codeActionProvider, diagnosticCollection));
    context.subscriptions.push(diagnosticCollection);

    context.subscriptions.push(new SVCodeActionProvider(explorerController, diagnosticCollection));
    context.subscriptions.push(new CodeFlowCodeLensProvider(explorerController));

    // Create File mapper command
    context.subscriptions.push(commands.registerCommand(FileMapper.MapCommand, mapFileCommand));

    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectNextCFStepCommand, CodeFlowDecorations.selectNextCFStep),
    );
    context.subscriptions.push(
        commands.registerCommand(CodeFlowDecorations.selectPrevCFStepCommand, CodeFlowDecorations.selectPrevCFStep),
    );

    // Instantiate the providers and file mapper which will register their listeners and register their disposables
    context.subscriptions.push(FileMapper.Instance);

    // Read the initial set of open SARIF files
    const reader: LogReader = LogReader.Instance;
    context.subscriptions.push(reader);

    // TODO: Need to add "Start floating promise" utility function here
    await reader.readAll();
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
