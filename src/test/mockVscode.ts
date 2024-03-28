// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Exceptions to make mocking easier.
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

/// <reference path="../panel/global.d.ts" />
/// Normally 'global.d.ts' auto imports, not sure why it's not working here.

import { DiagnosticSeverity } from 'vscode';
import { URI as Uri } from 'vscode-uri';
import { IndexStore } from '../panel/indexStore';
import { filtersColumn, filtersRow } from '../shared';
import { log } from './mockLog';
import * as path from 'path';

global.fetch = async () => ({ json: async () => log }) as unknown as Promise<Response>;
global.vscode = {
    postMessage: async (message: any) => {
        // console.log(`wv2ex message: ${JSON.stringify(message)}`)
        await mockVscodeTestFacing.panel_onDidReceiveMessage?.(message);
    }
};

export const uriForRealFile = Uri.file(path.normalize(path.join(__dirname, '..', '..', 'samples', 'propertyBags.sarif')));

export const mockVscodeTestFacing = {
    mockFileSystem: undefined as string[] | undefined,
    events: [] as string[],
    showOpenDialogResult: undefined as Uri[] | undefined,
    store: null as IndexStore | null,
    activateExtension: async (activate: Function) => {
        const context = {
            globalState: new Map(),
            subscriptions: [],
        };
        return await activate(context);
    },
    // Internal
    panel_onDidReceiveMessage: null as Function | null,
};

const registeredCommands: Record<string, Function> = {};

export const mockVscode = {
    // Extension-facing
    commands: {
        registerCommand: (name: string, func: Function) => {
            registeredCommands[name] = func;
        },
        executeCommand: async (name: string, ...args: any[]) => {
            const func = registeredCommands[name];
            if (!func) throw new Error(`Command '${name}' not registered.`);
            return await func(...args);
        }
    },
    Diagnostic: class {
        constructor(readonly range: Range, readonly message: string, readonly severity?: DiagnosticSeverity) {}
    },
    languages: {
        createDiagnosticCollection: () => {},
        registerCodeActionsProvider: () => {},
    },
    ProgressLocation: { Notification: 15 },
    Selection: class {
        constructor(readonly a: number, readonly b: number, readonly c: number, readonly d: number) {}
    },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    ThemeColor: class {},
    Uri,
    ViewColumn: { Two: 2 },
    window: {
        createTextEditorDecorationType: () => {},
        createWebviewPanel: () => {
            const defaultState = {
                filtersRow,
                filtersColumn,
            };

            // Simulate the top-level script block of the webview.
            (async () => {
                mockVscodeTestFacing.store = new IndexStore(defaultState);
                const spliceLogsData = {
                    command: 'spliceLogs',
                    removed: [],
                    added: [{ uri: uriForRealFile.toString(true), webviewUri: 'anyValue' }]
                };
                await mockVscodeTestFacing.store.onMessage({ data: spliceLogsData } as any);
            })();

            return {
                onDidDispose: () => {},
                reveal: () => {},
                webview: {
                    asWebviewUri: () => '',
                    onDidReceiveMessage: (f: Function) => mockVscodeTestFacing.panel_onDidReceiveMessage = f,
                    postMessage: async (message: any) => {
                        await mockVscodeTestFacing.store!.onMessage({ data: message } as any);
                        // console.log(`postMessage: ${JSON.stringify(message)}`)
                    },
                },
            };
        },
        onDidChangeTextEditorSelection: () => {},
        showErrorMessage: (message: any) => console.error(`showErrorMessage: '${message}'`),
        showInformationMessage: async (_message: string, ...choices: string[]) => choices[0], // = [0] => 'Locate...'
        showOpenDialog: async () => mockVscodeTestFacing.showOpenDialogResult,
        showTextDocument: (doc: { uri: any }) => {
            mockVscodeTestFacing.events.push(`showTextDocument ${doc.uri}`);
            const editor = {
                revealRange: () => {},
                set selection(value: any) {
                    mockVscodeTestFacing.events.push(`selection ${Object.values(value).join(' ')}`);
                },
            };
            return editor;
        },
        visibleTextEditors: [],
        withProgress: (_options: Record<string, any>, task: Function) => task({ report: () => {} }),
        createOutputChannel: () => {},
        registerUriHandler: () => {},
        createStatusBarItem: () => ({
            show: () => {},
        }),
        onDidChangeVisibleTextEditors: () => {},
    },
    workspace: {
        onDidChangeConfiguration: () => {},
        getConfiguration: () => new Map(),
        onDidOpenTextDocument: () => {},
        onDidCloseTextDocument: () => {},
        fs: {
            stat: async (uri: Uri) => {
                if (mockVscodeTestFacing.mockFileSystem && !mockVscodeTestFacing.mockFileSystem.includes(uri.fsPath)) throw new Error();
            },
        },
        openTextDocument: async (uri: Uri) => {
            if (mockVscodeTestFacing.mockFileSystem && !mockVscodeTestFacing.mockFileSystem.includes(uri.fsPath)) throw new Error();
            return {
                uri,
                lineAt: () => ({
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 2 },
                    },
                    firstNonWhitespaceCharacterIndex: 1,
                })
            };
        },
        findFiles: (include: string, _exclude?: string) => {
            if (include === '.sarif/**/*.sarif') {
                return [
                    uriForRealFile
                ];
            } else if (include === '**/file1.txt') {
                return [
                    Uri.file('/projects/project/file1.txt')
                ];
            } else if (include === '**/*') {
                return [
                    Uri.file('/projects/project/file1.txt')
                ];
            } else if (include === '**/file.txt') {
                return [
                    Uri.file('/x/y/a/file.txt')
                ];
            }
            return [];
        },
        registerTextDocumentContentProvider: () => {},
        textDocuments: [],
        onDidCreateFiles: () => {},
        onDidRenameFiles: () => {},
        onDidDeleteFiles: () => {},
        onDidChangeTextDocument: () => {},
    },

    CodeAction: class {
        constructor() { }
    },
    CodeActionKind: { QuickFix: { value: 'quickFix' } },
    StatusBarAlignment: { Left: 1, Right: 2 },
    Disposable: class {
        dispose() {}
    },
};
