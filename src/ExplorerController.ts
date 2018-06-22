// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { extensions, Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { Utilities } from "./Utilities";

/**
 * This class handles generating and providing the HTML content for the Explorer panel
 */
export class ExplorerController {
    public static readonly ExplorerTitle = "SARIF Explorer";
    private static instance: ExplorerController;
    private webviewPanel: WebviewPanel;
    private extensionPath: string;

    public static get Instance(): ExplorerController {
        return ExplorerController.instance || (ExplorerController.instance = new ExplorerController());
    }

    private constructor() {
        this.extensionPath = extensions.getExtension("MS-SarifVSCode.sarif-viewer").extensionPath;
    }

    public launchWebView() {
        this.webviewPanel = window.createWebviewPanel(
            "sarifExplorer", // Identifies the type of the webview. Used internally
            ExplorerController.ExplorerTitle, // Title of the panel displayed to the user
            ViewColumn.Two, // Editor column to show the new webview panel in.
            {
                enableScripts: true,
                localResourceRoots: [
                    Uri.file(Utilities.Path.join(this.extensionPath, "resources", "explorer")),
                    Uri.file(Utilities.Path.join(this.extensionPath, "out", "explorer")),
                ],
            }, // Webview options. More on these later.
        );

        this.webviewPanel.webview.onDidReceiveMessage(this.onReceivedMessage, this);
        this.webviewPanel.webview.html = this.getWebviewContent();
    }

    public getWebviewContent(): string {
        const cssMarkupDiskPath = Uri.file(Utilities.Path.join(this.extensionPath, "resources/explorer/explorer.css"));
        const scriptDiskPath = Uri.file(Utilities.Path.join(this.extensionPath, "out/explorer/explorerWebview.js"));
        const cssMarkup = cssMarkupDiskPath.with({ scheme: "vscode-resource" });
        const scriptPath = scriptDiskPath.with({ scheme: "vscode-resource" });

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sarif Explorer</title>
            <link rel="stylesheet" type="text/css" href = "${cssMarkup}">
        </head>
        <body>
        Open a Sarif file to load results into the Problems panel.<br/>
        Then double click a result in the Problems panel to populate the explorer.
        <script src="${scriptPath}"></script>
        </body>
        </html>`;
    }

    public onReceivedMessage(message) {
        let a;
        switch (message.type) {
            case "foo":
                a = "foo";
                break;
            case "bar":
                a = "bar";
                break;
        }
        return a;
    }

    public sendMessage(message: any, focus: boolean) {
        if (!this.webviewPanel.visible) {
            this.webviewPanel.reveal(undefined, focus);
        }
        this.webviewPanel.webview.postMessage(message);
    }
}
