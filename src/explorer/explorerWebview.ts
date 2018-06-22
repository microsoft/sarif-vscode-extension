// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { DiagnosticData, MessageType, WebviewMessage } from "./../Interfaces";

/**
 * This class handles generating and providing the HTML content for the Explorer panel
 */
export class ExplorerWebview {
    private vscode;

    public ExplorerWebview() {
        window.addEventListener("message", this.onMessage);
        // @ts-ignore: acquireVsCodeApi function is provided real time in the webview
        this.vscode = acquireVsCodeApi();

        setTimeout(this.sendMessage, 10000, {
            data: { diagnostic: undefined, activeTab: 4 } as DiagnosticData, type: MessageType.SourceLinkClicked,
        } as WebviewMessage);
    }


    public onMessage(event: any) {
        const message = event.data as WebviewMessage;
        switch (message.type) {
            case MessageType.NewDiagnostic:
                document.body.style.backgroundColor = "red";
                break;
            default:
                document.body.style.backgroundColor = "blue";
        }
    }

    public sendMessage(message: WebviewMessage) {
        this.vscode.postMessage(message);
    }

}

const explorerWebview = new ExplorerWebview();
