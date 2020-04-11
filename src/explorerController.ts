/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import { commands, Uri, ViewColumn, WebviewPanel, window, ExtensionContext, EventEmitter, Event, Disposable } from "vscode";
import * as path from "path";
import * as sarif from "sarif";
import { MessageType } from "./common/enums";
import { DiagnosticData, ResultsListData, WebviewMessage } from "./common/interfaces";
import { SarifViewerVsCodeDiagnostic } from "./sarifViewerDiagnostic";
import { Utilities } from "./utilities";
import { SVDiagnosticCollection } from "./svDiagnosticCollection";

/**
 * This class handles generating and providing the HTML content for the Explorer panel
 */
export class ExplorerController implements Disposable {
    private disposables: Disposable[] = [];

    public static readonly ExplorerLaunchCommand = 'extension.sarif.LaunchExplorer';

    public resultsListData: ResultsListData | undefined;

    /**
     * Contains the active diagnostic as known to the diagnostic collection.
     */
    private activeDiagnostic: SarifViewerVsCodeDiagnostic | undefined;

    // Verbosity setting, and corresponding event.
    private currentVerbosity: sarif.ThreadFlowLocation.importance = 'important';

    private onDidChangeVerbosityEventEmitter: EventEmitter<sarif.ThreadFlowLocation.importance> = new EventEmitter<sarif.ThreadFlowLocation.importance>();

    public get onDidChangeVerbosity(): Event<sarif.ThreadFlowLocation.importance> {
        return this.onDidChangeVerbosityEventEmitter.event;
    }

    public get selectedVerbosity(): sarif.ThreadFlowLocation.importance {
        return this.currentVerbosity;
    }

    public set selectedVerbosity(value: sarif.ThreadFlowLocation.importance) {
        if (this.currentVerbosity !== value) {
            this.currentVerbosity = value;
            this.onDidChangeVerbosityEventEmitter.fire(value);
        }
    }

    // Web view message events
    private onWebViewMessageEventEmitter: EventEmitter<WebviewMessage> = new EventEmitter<WebviewMessage>();

    public get onWebViewMessage(): Event<WebviewMessage> {
        return this.onWebViewMessageEventEmitter.event;
    }

    private activeTab: string | undefined;
    private selectedCodeFlowRow: string | undefined;
    private wvPanel: WebviewPanel | undefined;

    private get webviewPanel(): WebviewPanel {
        return this.createWebview();
    }

    public constructor(private readonly extensionContext: ExtensionContext, diagnosticCollection: SVDiagnosticCollection) {
        this.disposables.push(this.onDidChangeVerbosityEventEmitter);
        this.disposables.push(commands.registerCommand(ExplorerController.ExplorerLaunchCommand, this.createWebview.bind(this)));
        this.disposables.push(diagnosticCollection.onDidChangeActiveDiagnostic(this.onDidChangeActiveDiagnostic.bind(this)));
    }

    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * Creates the Webview panel
     */
    public createWebview(): WebviewPanel {
        if (!this.wvPanel) {
            this.wvPanel = window.createWebviewPanel('sarifExplorer', localize('explorer.Title', "SARIF Explorer"),
                { preserveFocus: true, viewColumn: ViewColumn.Two },
                {
                    enableScripts: true,
                    localResourceRoots: [
                        Uri.file(this.extensionContext.asAbsolutePath(path.posix.join('node_modules', 'requirejs'))),
                        Uri.file(this.extensionContext.asAbsolutePath(path.posix.join('resources', 'explorer'))),
                        Uri.file(this.extensionContext.asAbsolutePath(path.posix.join('out', 'explorer'))),
                    ],
                },
            );

            this.wvPanel.webview.onDidReceiveMessage(this.onReceivedMessage.bind(this), this);
            this.wvPanel.onDidDispose(this.onWebviewDispose.bind(this), this);
            this.wvPanel.webview.html = this.getWebviewContent(this.wvPanel);
        }

        return this.wvPanel;
    }

    /**
     * Clears the webviewpanel field if the weview gets closed
     */
    public onWebviewDispose(): void {
        this.wvPanel = undefined;
    }

    /**
     * Handles when a message comes in from the Webview
     * @param message the message from the webview describing the type and data of the message
     */
    public  onReceivedMessage(message: WebviewMessage): void {
        // Have the explorer controller set up whatever state it needs
        // BEFORE firing the event out so the stat is consistent in the
        // explorer controller before others receive the web view message.
        switch (message.type) {
            case MessageType.CodeFlowSelectionChange:
                this.selectedCodeFlowRow = message.data;
                break;

            case MessageType.VerbosityChanged:
                    if (!Utilities.isThreadFlowImportance(message.data)) {
                        throw new Error('Unhandled verbosity level');
                    }

                    if (this.selectedVerbosity !== message.data) {
                        this.selectedVerbosity = message.data;
                    }
                break;

            case MessageType.ExplorerLoaded:
                if (this.resultsListData) {
                    const webViewMessage: WebviewMessage = {
                        data: JSON.stringify(this.resultsListData),
                        type: MessageType.ResultsListDataSet
                    };
                    this.sendMessage(webViewMessage);
                }

                if (this.activeDiagnostic) {
                    this.sendActiveDiagnostic();
                }
                break;

            case MessageType.TabChanged:
                this.activeTab = message.data;
                break;
        }

        this.onWebViewMessageEventEmitter.fire(message);
    }

    /**
     * Sets the results list data and updates the Explore's results list data
     * @param dataSet new dataset to set
     */
    public setResultsListData(dataSet: ResultsListData): void {
        this.resultsListData = dataSet;
        const webviewMessage: WebviewMessage = {
            data: JSON.stringify(dataSet),
            type: MessageType.ResultsListDataSet
        };
        this.sendMessage(webviewMessage);
    }

    /**
     * sets the selected codeflow row, tells the webview to show and select the row
     * @param id Id of the codeflow row
     */
    public setSelectedCodeFlow(id: string): void {
        this.selectedCodeFlowRow = id;
        this.sendMessage({ data: id, type: MessageType.CodeFlowSelectionChange });
    }

    /**
     * Joins the path and converts it to a vscode resource schema
     * @param pathParts The path parts to join
     */
    private getVSCodeResourcePath(...pathParts: string[]): Uri {
        const vscodeResource: string = 'vscode-resource';
        const diskPath: string = this.extensionContext.asAbsolutePath(path.join(...pathParts));
        const uri: Uri = Uri.file(diskPath);
        return uri.with({ scheme: vscodeResource });
    }

    /**
     * defines the default webview html content
     */
    private getWebviewContent(webViewPanel: WebviewPanel): string {
        const resourcesPath: string[] = ['resources', 'explorer'];

        const cssExplorerDiskPath: Uri = this.getVSCodeResourcePath(...resourcesPath, 'explorer.css');
        const cssListTableDiskPath: Uri = this.getVSCodeResourcePath(...resourcesPath, 'listTable.css');
        const cssResultsListDiskPath: Uri = this.getVSCodeResourcePath(...resourcesPath, 'resultsList.css');
        const jQueryDiskPath: Uri = this.getVSCodeResourcePath(...resourcesPath, 'jquery-3.3.1.min.js');
        const colResizeDiskPath: Uri = this.getVSCodeResourcePath(...resourcesPath, 'colResizable-1.6.min.js');
        const requireJsPath: Uri = this.getVSCodeResourcePath('node_modules', 'requirejs', 'require.js');
        const explorerPath: Uri = this.getVSCodeResourcePath('out', 'explorer', 'systemExplorer.js');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sarif Explorer</title>
            <link rel="stylesheet" type="text/css" href = "${cssListTableDiskPath}">
            <link rel="stylesheet" type="text/css" href = "${cssExplorerDiskPath}">
            <link rel="stylesheet" type="text/css" href = "${cssResultsListDiskPath}">
            <script src="${jQueryDiskPath}"></script>
            <script src="${colResizeDiskPath}"></script>
            <script data-main="${explorerPath}" src="${requireJsPath}"></script>
        </head>
        <body>
            <div id="resultslistheader" class="headercontainer expanded"></div>
            <div id="resultslistcontainer">
                <div id="resultslistbuttonbar"></div>
                <div id="resultslisttablecontainer">
                    <table id="resultslisttable" class="listtable"></table>
                </div>
            </div>
            <div id="resultdetailsheader" class="headercontainer expanded"></div>
            <div id="resultdetailscontainer"></div>
            <script>
               requirejs(['systemExplorer'], function () {
                 require(["explorer/webview"], function(webView) {
                    webView.startExplorer();
                 });
               });
            </script>
        </body>
        </html>`;
    }

    /**
     * Creates the webview message based on the current active diagnostic and saved state and sends to the webview
     */
    private sendActiveDiagnostic(): void {

        if (!this.activeDiagnostic) {
            // Empty string is used to signal no selected diagnostic
            this.sendMessage({data: '', type: MessageType.NewDiagnostic});
            return;
        }

        const diagData: DiagnosticData = {
            activeTab: this.activeTab,
            selectedRow: this.selectedCodeFlowRow,
            selectedVerbosity: this.selectedVerbosity,
            resultInfo: this.activeDiagnostic.resultInfo,
            runInfo: this.activeDiagnostic.resultInfo.runInfo
        };

        const dataString: string = JSON.stringify(diagData);
        this.sendMessage({data: dataString, type: MessageType.NewDiagnostic});
    }

    /**
     * Handles sending a message to the webview
     * @param message Message to send, message has a type and data
     */
    private sendMessage(message: WebviewMessage): void {
        // We do not want to wait for this promise to finish as we are
        // just adding the message to the web-views queue.
        // tslint:disable-next-line: no-floating-promises
        this.webviewPanel.webview.postMessage(message);
    }

    private onDidChangeActiveDiagnostic(diagnostic: SarifViewerVsCodeDiagnostic | undefined): void {
        // When the active diagnostic changes, then clear the active tab (which is the "Result Info", "Run Info", "Code Flow", etc.)
        // to be undefined. That will cause the web-view to default to either "Result Info" or "Code Flow" tabs
        // depending on what is present in the data.
        this.activeTab = undefined;
        this.selectedCodeFlowRow = undefined;
        this.activeDiagnostic = diagnostic;

        this.sendActiveDiagnostic();
    }
}
