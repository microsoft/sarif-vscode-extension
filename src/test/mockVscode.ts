// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="../panel/global.d.ts" />
/// Why is this also needed here.

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import mock from 'mock-require'
import { IndexStore } from '../panel/indexStore'
import { filtersColumn, filtersRow } from '../shared'
import { log } from './mockLog'
import { DiagnosticSeverity } from 'vscode'

global.fetch = async () => ({ json: async () => log }) as unknown as Promise<Response>
global.vscode = {
	postMessage: async (message: any) => {
		// console.log(`wv2ex message: ${JSON.stringify(message)}`)
		await mockVscode.panel_onDidReceiveMessage?.(message)
	}
}

class Uri {
	constructor(readonly fsPath: string) {}
	toString() { return `file://${this.fsPath}` }
	static file(path: string) { return new Uri(path) }
	static parse(uri: string) {
		return new Uri(uri.replace('file://', ''))
	}
}

export const mockChildProcess = {
	onExecFileSync: undefined as (() => void) | undefined
}

export const mockVscode = {
	// Test-facing
	mockReadFile: undefined as string | undefined,
	mockFileSystem: undefined as string[] | undefined,
	events: [] as string[],
	showOpenDialogResult: undefined as string[] | undefined,
	store: null as IndexStore | null,
	activateExtension: async (activate: Function) => {
		const context = {
			globalState: new Map(),
			subscriptions: [],
		}
		return await activate(context)
	},

	// Internal
	panel_onDidReceiveMessage: null as Function | null,

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
				version: 0,
				filtersRow,
				filtersColumn,
			}
			mockVscode.store = new IndexStore(defaultState)
			return {
				onDidDispose: () => {},
				webview: {
					asWebviewUri: () => '',
					onDidReceiveMessage: (f: Function) => mockVscode.panel_onDidReceiveMessage = f,
					postMessage: async (message: any) => {
						await mockVscode.store!.onMessage({ data: message } as any)
						// console.log(`postMessage: ${JSON.stringify(message)}`)
					},
				},
			}
		},
		showErrorMessage: (message: any) => console.error(`showErrorMessage: '${message}'`),
		showInformationMessage: async (_message: string, ...choices: string[]) => choices[0], // = [0] => 'Locate...'
		showOpenDialog: async () => mockVscode.showOpenDialogResult!.map(path => ({ path })),
		showTextDocument: (doc: { uri: any }) => {
			mockVscode.events.push(`showTextDocument ${doc.uri}`)
			const editor = {
				revealRange: () => {},
				set selection(value: any) {
					mockVscode.events.push(`selection ${Object.values(value).join(' ')}`)
				},
			}
			return editor
		},
		visibleTextEditors: [],
		withProgress: (_options: Record<string, any>, task: Function) => task({ report: () => {} })
	},
	workspace: {
		getConfiguration: () => new Map(),
		onDidOpenTextDocument: () => {},
		onDidCloseTextDocument: () => {},
		openTextDocument: (uri: { fsPath: string }) => {
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
		findFiles: (include: string, _exclude?: string) => {
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

mock('child_process', {
	execFileSync: (command: string, args?: ReadonlyArray<string>) => {
		mockChildProcess.onExecFileSync?.()
		execFileSync(command, args)
	}
})
mock('fs', {
	readFileSync: (path: string, options: Record<string, any>) => {
		return mockVscode.mockReadFile ?? readFileSync(path, options)
	}
})
mock('vscode', mockVscode)