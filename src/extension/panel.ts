// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import jsonMap from 'json-source-map';
import { autorun, IArraySplice, observable, observe } from 'mobx';
import { Log, Region, Result } from 'sarif';
import { commands, ExtensionContext, TextEditorRevealType, Uri, ViewColumn, WebviewPanel, window, workspace } from 'vscode';
import { CommandPanelToExtension, filtersColumn, filtersRow, JsonMap, ResultId } from '../shared';
import { loadLogs } from './loadLogs';
import { regionToSelection } from './regionToSelection';
import { Store } from './store';
import { UriRebaser } from './uriRebaser';

export class Panel {
    private title = 'SARIF Result'
    @observable private panel: WebviewPanel | null = null

    constructor(
        readonly context: Pick<ExtensionContext, 'extensionPath' | 'subscriptions'>,
        readonly basing: UriRebaser,
        readonly store: Pick<Store, 'logs' | 'results'>) {
        observe(store.logs, change => {
            const {type, removed, added} = change as unknown as IArraySplice<Log>;
            if (type !== 'splice') throw new Error('Only splice allowed on store.logs.');
            this.spliceLogs(removed, added);
        });
        autorun(() => {
            const count = store.results.length;
            if (!this.panel) return;
            this.panel.title = `${count} ${this.title}${count === 1 ? '' : 's'}`;
        });
    }

    public async show() {
        if (this.panel) {
            if (!this.panel.active) this.panel.reveal(undefined, true);
            return;
        }

        const {context, basing, store} = this;
        const {webview} = this.panel = window.createWebviewPanel(
            'Index', `${this.title}s`, { preserveFocus: true, viewColumn: ViewColumn.Two }, // ViewColumn.Besides steals focus regardless of preserveFocus.
            {
                enableScripts: true,
                localResourceRoots: [Uri.file('/'), ...'abcdefghijklmnopqrstuvwxyz'.split('').map(c => Uri.file(`${c}:`))],
                retainContextWhenHidden: true,
            }
        );
        this.panel.onDidDispose(() => this.panel = null);

        const src = Uri.file(`${context.extensionPath}/out/panel.js`);
        const defaultState = {
            version: 0,
            filtersRow,
            filtersColumn,
        };
        const state = Store.globalState.get('view', defaultState);
        const workspaceUri = workspace.workspaceFolders?.[0]?.uri.toString();
        webview.html = `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="
                    default-src 'none';
                    connect-src vscode-resource:;
                    font-src    vscode-resource:;
                    script-src  vscode-resource: 'unsafe-inline';
                    style-src   vscode-resource: 'unsafe-inline';
                    ">
                <style>
                    code { font-family: ${workspace.getConfiguration('editor').get('fontFamily')} }
                </style>
            </head>
            <body>
                <div id="root"></div>
                <script src="${webview.asWebviewUri(src).toString()}"></script>
                <script>
                    vscode = acquireVsCodeApi();
                    (async () => {
                        const store = new Store(${JSON.stringify(state)}, ${workspaceUri ? `'${workspaceUri}'` : 'undefined'})
                        await store.onMessage({ data: ${JSON.stringify(this.createSpliceLogsMessage([], store.logs))} })
                        ReactDOM.render(
                            React.createElement(Index, { store }),
                            document.getElementById('root'),
                        )
                    })();
                </script>
            </body>
            </html>`;

        webview.onDidReceiveMessage(async message => {
            if (!message) return;
            switch (message.command as CommandPanelToExtension) {
                case 'open': {
                    const uris = await window.showOpenDialog({
                        canSelectMany: true,
                        defaultUri: workspace.workspaceFolders?.[0]?.uri,
                        filters: { 'SARIF files': ['sarif', 'json'] },
                    });
                    if (!uris) return;
                    store.logs.push(...await loadLogs(uris));
                    break;
                }
                case 'closeLog': {
                    store.logs.removeFirst(log => log._uri === message.uri);
                    break;
                }
                case 'closeAllLogs': {
                    store.logs.splice(0);
                    break;
                }
                case 'select': {
                    const {logUri, uri, region} = message as { logUri: string, uri: string, region: Region};
                    const validatedUri = await basing.translateArtifactToLocal(uri);
                    if (!validatedUri) return;
                    await this.selectLocal(logUri, validatedUri, region);
                    break;
                }
                case 'selectLog': {
                    const [logUri, runIndex, resultIndex] = message.id as ResultId;
                    const log = store.logs.find(log => log._uri === logUri);
                    if (!log) return;

                    const logUriUpgraded = log._uriUpgraded ?? log._uri;
                    if (!log._jsonMap) {
                        const file = fs.readFileSync(Uri.parse(logUriUpgraded).fsPath, 'utf8')  // Assume scheme file.
                            .replace(/^\uFEFF/, ''); // Trim BOM.
                        log._jsonMap = (jsonMap.parse(file) as { pointers: JsonMap }).pointers;
                    }

                    const { value, valueEnd } = log._jsonMap[`/runs/${runIndex}/results/${resultIndex}`];
                    const resultRegion = {
                        startLine: value.line,
                        startColumn: value.column,
                        endLine: valueEnd.line,
                        endColumn: valueEnd.column,
                    } as Region;
                    await this.selectLocal(logUri, logUriUpgraded, resultRegion);
                    break;
                }
                case 'setState': {
                    const oldState = Store.globalState.get('view', defaultState);
                    const {state} = message;
                    await Store.globalState.update('view', Object.assign(oldState, JSON.parse(state)));
                    break;
                }
                default:
                    throw new Error(`Unhandled command: ${message.command}`,);
            }
        }, undefined, context.subscriptions);
    }

    public async selectLocal(logUri: string, localUri: string, region: Region | undefined) {
        // Keep/pin active Log as needed
        for (const editor of window.visibleTextEditors.slice()) {
            if (editor.document.uri.toString() !== logUri) continue;
            await window.showTextDocument(editor.document, editor.viewColumn);
            await commands.executeCommand('workbench.action.keepEditor');
        }

        const doc = await workspace.openTextDocument(Uri.parse(localUri, true));
        const editor = await window.showTextDocument(doc, ViewColumn.One, true);

        if (region === undefined) return;
        editor.selection = regionToSelection(doc, region);
        editor.revealRange(editor.selection, TextEditorRevealType.InCenterIfOutsideViewport);
    }

    public select(result: Result) {
        if (!result?._id) return; // Reduce Panel selection flicker.
        this.panel?.webview.postMessage({ command: 'select', id: result?._id });
    }

    private createSpliceLogsMessage(removed: Log[], added: Log[]) {
        return {
            command: 'spliceLogs',
            removed: removed.map(log => log._uri),
            added: added.map(log => ({
                uri: log._uri,
                uriUpgraded: log._uriUpgraded,
                webviewUri: this.panel?.webview.asWebviewUri(Uri.parse(log._uriUpgraded ?? log._uri, true)).toString(),
            })),
        };
    }

    private async spliceLogs(removed: Log[], added: Log[]) {
        await this.panel?.webview.postMessage(this.createSpliceLogsMessage(removed, added));
    }
}
