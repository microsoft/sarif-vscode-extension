// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="../panel/global.d.ts" />
/// Why is this also needed here.

import { readFileSync } from 'fs'
import mock from 'mock-require'
import { IndexStore } from '../panel/IndexStore'
import { filtersColumn, filtersRow } from '../shared'
import { log } from './mockLog'

global.fetch = async () => ({ json: async () => log })
global.vscode = {
	postMessage: async message => {
		// console.log(`wv2ex message: ${JSON.stringify(message)}`)
		await mockVscode.panel_onDidReceiveMessage?.(message)
	}
}

class Uri {
	constructor(readonly fsPath: string) {}
	toString() { return `file://${this.fsPath}` }
	static file(path) { return new Uri(path) }
	static parse(uri) {
		return new Uri(uri.replace('file://', ''))
	}
}

export const mockVscode = {
	// Test-facing
	mockReadFile: undefined as string,
	mockFileSystem: undefined as string[],
	events: [] as string[],
	showOpenDialogResult: undefined as string[],
	store: null as IndexStore,
	activateExtension: async (activate: Function) => {
		const context = {
			globalState: new Map(),
			subscriptions: [],
		}
		await activate(context)
	},

	// Internal
	panel_onDidReceiveMessage: null as any,

	// Extension-facing
	commands: {
		registerCommand: () => {},
	},
	languages: {
		createDiagnosticCollection: () => {},
		registerCodeActionsProvider: () => {},
	},
	ProgressLocation: { Notification: 15 },
	Selection: class {
		constructor(readonly a, readonly b, readonly c, readonly d) {}
	},
	TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
	ThemeColor: class {},
	Uri,
	ViewColumn: { Two: 2 },
	window: {
		createTextEditorDecorationType: () => {},
		createWebviewPanel: () => {
			const defaultState = {
				version: 0,
				filtersRow,
				filtersColumn,
			}
			mockVscode.store = new IndexStore(defaultState)
			return {
				onDidDispose: () => {},
				webview: {
					asWebviewUri: () => '',
					onDidReceiveMessage: f => mockVscode.panel_onDidReceiveMessage = f,
					postMessage: async message => {
						await mockVscode.store.onMessage({ data: message } as any)
						// console.log(`postMessage: ${JSON.stringify(message)}`)
					},
				},
			}
		},
		showErrorMessage: message => console.error(`showErrorMessage: '${message}'`),
		showInformationMessage: async (message, ...choices) => choices[0], // = [0] => 'Locate...'
		showOpenDialog: async () => mockVscode.showOpenDialogResult.map(path => ({ path })),
		showTextDocument: doc => {
			mockVscode.events.push(`showTextDocument ${doc.uri}`)
			const editor = {
				revealRange: () => {},
				set selection(value) {
					mockVscode.events.push(`selection ${Object.values(value).join(' ')}`)
				},
			}
			return editor
		},
		visibleTextEditors: [],
		withProgress: (options, task) => task({ report: () => {} })
	},
	workspace: {
		getConfiguration: () => new Map(),
		onDidOpenTextDocument: () => {},
		onDidCloseTextDocument: () => {},
		openTextDocument: uri => {
			// console.log(`openTextDocument ${uri}`)
			if (mockVscode.mockFileSystem && !mockVscode.mockFileSystem.includes(uri.fsPath)) throw new Error()
			return {
				uri,
				lineAt: () => ({
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 2 },
					},
					firstNonWhitespaceCharacterIndex: 1,
				})
			}
		},
		findFiles: (include: string, exclude?: string) => {
			if (include === '.sarif/**/*.sarif') {
				return [
					new Uri('/.sarif/test.sarif')
				]
			}
			return []
		},
		registerTextDocumentContentProvider: () => {},
		textDocuments: [],
	},
}

mock('fs', {
	readFileSync: (path, options) => {
		return mockVscode.mockReadFile ?? readFileSync(path, options)}
})
mock('vscode', mockVscode)