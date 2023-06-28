// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { diffChars } from 'diff';
import * as fs from 'fs';
import jsonMap from 'json-source-map';
import { autorun, IArraySplice, observable, observe } from 'mobx';
import { Log, Region, Result } from 'sarif';
import { commands, ExtensionContext, TextEditorRevealType, Uri, ViewColumn, WebviewPanel, window, workspace } from 'vscode';
import { CommandPanelToExtension, filtersColumn, filtersRow, JsonMap, ResultId } from '../shared';
import { getOriginalDoc } from './getOriginalDoc';
import { loadLogs } from './loadLogs';
import { driftedRegionToSelection } from './regionToSelection';
import { Store } from './store';
import { UriRebaser } from './uriRebaser';

export class Panel {
    private title = 'SARIF Result'
    @observable private panel: WebviewPanel | null = null

    constructor(
        readonly context: Pick<ExtensionContext, 'extensionPath' | 'subscriptions'>,
        readonly basing: UriRebaser,
        readonly store: Pick<Store, 'analysisInfo' | 'banner' | 'disableSelectionSync' | 'logs' | 'results' | 'resultsFixed' | 'remoteAnalysisInfoUpdated'>) {
        observe(store.logs, change => {
            const {type, removed, added} = change as unknown as IArraySplice<Log>;
            if (type !== 'splice') throw new Error('Only splice allowed on store.logs.');
            this.spliceLogs(removed, added);
        });
        observe(store.resultsFixed, change => {
            const {type, removed, added} = change as unknown as IArraySplice<string>;
            if (type !== 'splice') throw new Error('Only splice allowed on store.resultFixes.');
            this.spliceResultsFixed(removed, added);
        });
        autorun(() => {
            const count = store.results.length;
            if (!this.panel) return;
            this.panel.title = `${count} ${this.title}${count === 1 ? '' : 's'}`;
        });
        autorun(() => {
            this.panel?.webview.postMessage({ command: 'setBanner', text: store.banner });
        });
    }

    public async show() {
        if (this.panel) {
            if (!this.panel.active) this.panel.reveal(undefined, true);
            return;
        }

        const {context, basing, store} = this;
        const {webview} = this.panel = window.createWebviewPanel(
            'sarif', `${this.title}s`, { preserveFocus: true, viewColumn: ViewColumn.Two }, // ViewColumn.Besides steals focus regardless of preserveFocus.
            {
                enableCommandUris: true,
                enableScripts: true,
                localResourceRoots: [Uri.file('/'), ...'abcdefghijklmnopqrstuvwxyz'.split('').map(c => Uri.file(`${c}:`))],
                retainContextWhenHidden: true,
            }
        );
        this.panel.onDidDispose(() => this.panel = null);

        const srcPanel = Uri.file(`${context.extensionPath}/out/panel.js`);
        const srcInit = Uri.file(`${context.extensionPath}/out/init.js`);
        const defaultState = {
            version: 0,
            filtersRow,
            filtersColumn,
        };

        // JSON.stringify emits double quotes. To not conflict, certain attribute values use single quotes.
        webview.html = `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="
                    default-src 'none';
                    connect-src vscode-resource:;
                    font-src    vscode-resource:;
                    img-src     data:;
                    script-src  vscode-resource:;
                    style-src   vscode-resource: 'unsafe-inline';
                    ">
                <meta name="storeState"        content='${JSON.stringify(Store.globalState.get('view', defaultState))}'>
                <meta name="storeWorkspaceUri" content="${workspace.workspaceFolders?.[0]?.uri.toString() ?? ''}">
                <meta name="storeBanner"       content='${store.banner}'>
                <style>
                    code { font-family: ${workspace.getConfiguration('editor').get('fontFamily')} }
                </style>
            </head>
            <body>
                <div id="error" style="display: none; padding: 10px;"></div>
                <div id="root"></div>
                <script src="${webview.asWebviewUri(srcPanel).toString()}"></script>
                <script src="${webview.asWebviewUri(srcInit).toString()}"></script>
            </body>
            </html>`;

        webview.onDidReceiveMessage(async message => {
            if (!message) return;
            switch (message.command as CommandPanelToExtension) {
                case 'load' : {
                    // Extension sends Panel an initial set of logs.
                    await this.panel?.webview.postMessage(this.createSpliceLogsMessage([], store.logs));
                    break;
                }
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
                    const {logUri, uri, uriBase, region} = message as { logUri: string, uri: string, uriBase: string | undefined, region: Region};
                    const [_, runIndex] = message.id as ResultId;

                    const log = store.logs.find(log => log._uri === logUri);
                    if (!log) return;

                    const versionControlProvenance = log.runs[runIndex].versionControlProvenance;
                    const validatedUri = await basing.translateArtifactToLocal(uri, uriBase, versionControlProvenance);
                    if (!validatedUri) return;
                    await this.selectLocal(logUri, validatedUri, region);
                    break;
                }
                case 'selectLog': {
                    const [logUri, runIndex, resultIndex] = message.id as ResultId;
                    const log = store.logs.find(log => log._uri === logUri);
                    if (!log) return;

                    const logUriUpgraded = Uri.parse(log._uriUpgraded ?? log._uri, true);
                    if (!log._jsonMap) {
                        const file = fs.readFileSync(logUriUpgraded.fsPath, 'utf8')  // Assume scheme file.
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
                case 'refresh': {
                    await store.remoteAnalysisInfoUpdated++;
                    break;
                }
                case 'removeResultFixed': {
                    const idToRemove = JSON.stringify(message.id);
                    store.resultsFixed.removeFirst(id => id === idToRemove);
                    break;
                }
                default:
                    throw new Error(`Unhandled command: ${message.command}`,);
            }
        }, undefined, context.subscriptions);
    }

    public async selectLocal(logUri: string, localUri: Uri, region: Region | undefined) {
        // Keep/pin active Log as needed
        for (const editor of window.visibleTextEditors.slice()) {
            if (editor.document.uri.toString() !== logUri) continue;
            await window.showTextDocument(editor.document, editor.viewColumn);
            await commands.executeCommand('workbench.action.keepEditor');
        }

        const currentDoc = await workspace.openTextDocument(localUri);

        // `disableSelectionSync` prevents a selection sync feedback loop in cases where:
        // 1) `showTextDocument` creates a new editor (where no editor was already open).
        // 2) The selection is restored, and starts one "thread" of selection sync.
        // 3) Then `revealRange` (see below) will start another "thread" of selection sync.
        // 4) The rapid succession causes a "reverberation" where the selection gets stuck jumping between both results.
        this.store.disableSelectionSync = true;
        const editor = await window.showTextDocument(currentDoc, ViewColumn.One, true);
        this.store.disableSelectionSync = false;

        if (region === undefined) return;

        const originalDoc = await getOriginalDoc(this.store.analysisInfo?.commit_sha, currentDoc);
        const diffBlocks = originalDoc ? diffChars(originalDoc.getText(), currentDoc.getText()) : [];

        editor.selection = driftedRegionToSelection(diffBlocks, currentDoc, region, originalDoc);
        editor.revealRange(editor.selection, TextEditorRevealType.InCenterIfOutsideViewport);
    }

    public select(result: Result) {
        if (!result?._id) return; // Reduce Panel selection flicker.
        this.panel?.webview.postMessage({ command: 'select', id: result?._id });
    }

    public selectByIndex(uri: Uri, runIndex: number, resultIndex: number) {
        const log = this.store.logs.find(log => log._uri === uri.toString());
        const result = log?.runs?.[runIndex]?.results?.[resultIndex];
        if (!result) return;

        this.select(result);
    }

    private createSpliceLogsMessage(removed: Log[], added: Log[]) {
        return {
            command: 'spliceLogs',
            removed: removed.map(log => log._uri),
            added: added.map(log => ({
                text: log._text,
                uri: log._uri,
                uriUpgraded: log._uriUpgraded,
                webviewUri: log._text ? '' : this.panel?.webview.asWebviewUri(Uri.parse(log._uriUpgraded ?? log._uri, true)).toString(),
            })),
        };
    }

    private async spliceLogs(removed: Log[], added: Log[]) {
        await this.panel?.webview.postMessage(this.createSpliceLogsMessage(removed, added));
    }

    private async spliceResultsFixed(removed: string[], added: string[]) {
        await this.panel?.webview.postMessage({
            command: 'spliceResultsFixed',
            removed,
            added,
        });
    }
}
