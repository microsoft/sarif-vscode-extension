// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Exceptions to make mocking easier.
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

/// <reference path="../panel/global.d.ts" />
/// Normally 'global.d.ts' auto imports, not sure why it's not working here.

import { DiagnosticSeverity } from 'vscode';
import { IndexStore } from '../panel/indexStore';
import { filtersColumn, filtersRow } from '../shared';
import { log } from './mockLog';

global.fetch = async () => ({ json: async () => log }) as unknown as Promise<Response>;
global.vscode = {
	postMessage: async (message: any) => {
		// console.log(`wv2ex message: ${JSON.stringify(message)}`)
		await mockVscodeTestFacing.panel_onDidReceiveMessage?.(message);
	}
};

class Uri {
	constructor(readonly fsPath: string) {}
	toString() { return `file://${this.fsPath}`; }
	static file(path: string) { return new Uri(path); }
	static parse(uri: string) {
		return new Uri(uri.replace('file://', ''));
	}
}

export const mockVscodeTestFacing = {
	mockFileSystem: undefined as string[] | undefined,
	events: [] as string[],
	showOpenDialogResult: undefined as string[] | undefined,
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

export const mockVscode = {
	// Extension-facing
	commands: {
		registerCommand: () => {},
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
			mockVscodeTestFacing.store = new IndexStore(defaultState);
			return {
				onDidDispose: () => {},
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
		showErrorMessage: (message: any) => console.error(`showErrorMessage: '${message}'`),
		showInformationMessage: async (_message: string, ...choices: string[]) => choices[0], // = [0] => 'Locate...'
		showOpenDialog: async () => mockVscodeTestFacing.showOpenDialogResult!.map(path => ({ path })),
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
		withProgress: (_options: Record<string, any>, task: Function) => task({ report: () => {} })
	},
	workspace: {
		onDidChangeConfiguration: () => {},
		getConfiguration: () => new Map(),
		onDidOpenTextDocument: () => {},
		onDidCloseTextDocument: () => {},
		openTextDocument: async (uri: { fsPath: string }) => {
			// console.log(`openTextDocument ${uri}`)
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
					new Uri('/.sarif/test.sarif')
				];
			}
			return [];
		},
		registerTextDocumentContentProvider: () => {},
		textDocuments: [],
	},
};
