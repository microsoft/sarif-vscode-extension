// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { commands, ExtensionContext, Uri, ViewColumn } from "vscode";
import { ExplorerContentProvider } from "./ExplorerContentProvider";
import { FileMapper } from "./FileMapper";
import { LogReader } from "./LogReader";
import { SVCodeActionProvider } from "./SVCodeActionProvider";

/**
 * This method is called when the extension is activated.
 * Creates the explorer, reader, provider
 * Process any open SARIF Files
 */
export function activate(context: ExtensionContext) {
    const reader = LogReader.Instance;
    const explorerProvider = ExplorerContentProvider.Instance;
    explorerProvider.context = context;

    // Create the launch Explorer command
    const explorerCommandDisposable = commands.registerCommand(ExplorerContentProvider.ExplorerLaunchCommand, () => {
        commands.executeCommand("vscode.previewHtml", ExplorerContentProvider.ExplorerUri, ViewColumn.Two,
            ExplorerContentProvider.ExplorerTitle);
    });

    // Create the Explorer callback command
    const explorerRequestDisposable = commands.registerCommand(ExplorerContentProvider.ExplorerCallbackCommand,
        ExplorerContentProvider.Instance.explorerCallback);

    const remapCodeActionCommandDisposable = commands.registerCommand(FileMapper.MapCommand, (file: string) => {
        FileMapper.Instance.getUserToChooseFile(Uri.parse(file));
    });

    // Instantiate the CodeActionProvider which will register it's listeners
    const codeActionProvider = SVCodeActionProvider.Instance;

    // Read the initial set of open SARIF files
    reader.readAll();

    // Add to a list of disposables which are disposed when this extension is deactivated.
    context.subscriptions.push(reader);
    context.subscriptions.push(explorerProvider);
    context.subscriptions.push(explorerCommandDisposable);
    context.subscriptions.push(explorerRequestDisposable);
    context.subscriptions.push(codeActionProvider);
    context.subscriptions.push(remapCodeActionCommandDisposable);
    context.subscriptions.push(FileMapper.Instance);
}

/**
 * Clean up extension if it gets deactivated
 */
export function deactivate() {
    // ToDo: rusty: Close html preview, unregister events, clear diagnostic collection
    return undefined;
}
