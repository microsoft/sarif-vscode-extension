// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { commands, extensions, Range, Uri, ViewColumn, WebviewPanel, window } from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { MessageType } from "./common/Enums";
import { DiagnosticData, Location, LocationData, SarifViewerDiagnostic, WebviewMessage } from "./common/Interfaces";
import { sarif } from "./common/SARIFInterfaces";
import { LocationFactory } from "./LocationFactory";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";
import { Utilities } from "./Utilities";

/**
 * This class handles generating and providing the HTML content for the Explorer panel
 */
export class ExplorerController {
    public static readonly ExplorerLaunchCommand = "extension.sarif.LaunchExplorer";
    public static readonly SendCFSelectionToExplorerCommand = "extension.sarif.SendCFSelectionToExplorer";
    public static readonly ExplorerTitle = "SARIF Explorer";

    private static instance: ExplorerController;

    public activeSVDiagnostic: SarifViewerDiagnostic;
    public selectedVerbosity: string;

    private activeTab: string;
    private extensionPath: string;
    private selectedRow: string;
    private wvPanel: WebviewPanel;

    public static get Instance(): ExplorerController {
        return ExplorerController.instance || (ExplorerController.instance = new ExplorerController());
    }

    private get webviewPanel(): WebviewPanel {
        if (this.wvPanel === undefined) {
            this.createWebview();
        }

        return this.wvPanel;
    }

    private constructor() {
        this.extensionPath = extensions.getExtension("MS-SarifVSCode.sarif-viewer").extensionPath;

        window.onDidChangeVisibleTextEditors(CodeFlowDecorations.onVisibleTextEditorsChanged, this);
    }

    /**
     * Creates the Webview panel
     */
    public createWebview(): void {
        if (this.wvPanel !== undefined) {
            if (!this.wvPanel.visible) {
                this.wvPanel.reveal(undefined, false);
            }
        } else {
            this.wvPanel = window.createWebviewPanel("sarifExplorer", ExplorerController.ExplorerTitle,
                { preserveFocus: true, viewColumn: ViewColumn.Two },
                {
                    enableScripts: true,
                    localResourceRoots: [
                        Uri.file(Utilities.Path.join(this.extensionPath, "resources", "explorer")),
                        Uri.file(Utilities.Path.join(this.extensionPath, "out", "explorer")),
                    ],
                },
            );

            this.wvPanel.webview.onDidReceiveMessage(this.onReceivedMessage, this);
            this.wvPanel.onDidDispose(this.onWebviewDispose, this);
            this.wvPanel.webview.html = this.getWebviewContent();
        }
    }

    /**
     * Clears the webviewpanel field if the weview gets closed
     */
    public onWebviewDispose() {
        this.wvPanel = undefined;
    }

    /**
     * Handles when a message comes in from the Webview
     * @param message the message from the webview describing the type and data of the message
     */
    public onReceivedMessage(message: WebviewMessage) {
        switch (message.type) {
            case MessageType.AttachmentSelectionChange:
                const selectionId = (message.data as string).split("_");
                const attachmentId = parseInt(selectionId[0], 10);
                if (selectionId.length > 1) {
                    CodeFlowDecorations.updateAttachmentSelection(attachmentId, parseInt(selectionId[1], 10));
                } else {
                    const diagnostic = ExplorerController.Instance.activeSVDiagnostic;
                    LocationFactory.getOrRemap(diagnostic.resultInfo.attachments[attachmentId].file,
                        {
                            physicalLocation: {
                                fileLocation: diagnostic.rawResult.attachments[attachmentId].fileLocation,
                            },
                        } as sarif.Location)
                        .then((loc: Location) => {
                            commands.executeCommand("vscode.open", loc.uri,
                                ViewColumn.One);
                        });
                }
                break;
            case MessageType.CodeFlowSelectionChange:
                this.selectedRow = message.data;
                CodeFlowDecorations.updateCodeFlowSelection(this.selectedRow);
                break;
            case MessageType.SourceLinkClicked:
                const locData = JSON.parse(message.data) as LocationData;
                const location = {
                    mapped: true,
                    range: new Range(parseInt(locData.sLine, 10), parseInt(locData.sCol, 10),
                        parseInt(locData.eLine, 10), parseInt(locData.eCol, 10)),
                    uri: Uri.parse(locData.file),
                } as Location;
                CodeFlowDecorations.updateSelectionHighlight(location, undefined);
                break;
            case MessageType.VerbosityChanged:
                if (this.selectedVerbosity !== message.data) {
                    this.selectedVerbosity = message.data;
                    CodeFlowCodeLensProvider.Instance.triggerCodeLensRefresh();
                }
                break;
            case MessageType.ExplorerLoaded:
                if (this.activeSVDiagnostic !== undefined) {
                    this.sendActiveDiagnostic(true);
                }
                break;
            case MessageType.TabChanged:
                this.activeTab = message.data;
                break;
        }
    }

    /**
     * Sets the active diagnostic that's showns in the Webview, resets the saved webview state(selected row, etc.)
     * @param diag diagnostic to show
     */
    public setActiveDiagnostic(diag: SarifViewerDiagnostic) {
        if (this.activeSVDiagnostic === undefined || this.activeSVDiagnostic !== diag) {
            this.activeSVDiagnostic = diag;
            this.activeTab = undefined;
            this.selectedRow = undefined;
            this.selectedVerbosity = undefined;
            this.sendActiveDiagnostic(false);
        }
    }

    /**
     * sets the selected codeflow row, tells the webview to show and select the row
     * @param id Id of the codeflow row
     */
    public setSelectedCodeFlow(id: string) {
        this.selectedRow = id;
        this.sendMessage({ data: id, type: MessageType.CodeFlowSelectionChange } as WebviewMessage, false);
    }

    /**
     * defines the default webview html content
     */
    private getWebviewContent(): string {
        const cssMarkupDiskPath = Uri.file(Utilities.Path.join(this.extensionPath, "resources/explorer/explorer.css"));
        const scriptDiskPath = Uri.file(Utilities.Path.join(this.extensionPath, "out/explorer/explorer/webview.js"));
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
            <div>
                Open a Sarif file to load results into the Problems panel.
                <br/>
                Then double click a result in the Problems panel to populate the explorer.
            </div>
            <script src="${scriptPath}"></script>
        </body>
        </html>`;
    }

    /**
     * Creates the webview message based on the current active dialog and saved state and sends to the webview
     * @param focus flag for setting focus to the webview
     */
    private sendActiveDiagnostic(focus: boolean) {
        const diagData = {
            activeTab: this.activeTab,
            resultInfo: this.activeSVDiagnostic.resultInfo,
            runInfo: SVDiagnosticCollection.Instance.getRunInfo(this.activeSVDiagnostic.runId),
            selectedRow: this.selectedRow,
            selectedVerbosity: this.selectedVerbosity,
        } as DiagnosticData;
        this.sendMessage({
            data: JSON.stringify(diagData), type: MessageType.NewDiagnostic,
        } as WebviewMessage, focus);
    }

    /**
     * Handles sending a message to the webview
     * @param message Message to send, message has a type and data
     * @param focus flag for if the webview panel should be given focus
     */
    private sendMessage(message: WebviewMessage, focus: boolean) {
        if (!this.webviewPanel.visible) {
            this.webviewPanel.reveal(undefined, !focus);
        }
        this.webviewPanel.webview.postMessage(message);
    }
}
