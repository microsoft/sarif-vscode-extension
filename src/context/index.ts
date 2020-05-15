// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computed, IArrayWillSplice, intercept, observable, observe } from 'mobx'
import { Log, Result } from 'sarif'
import { commands, DiagnosticSeverity, ExtensionContext, extensions, languages, Memento, Range, Selection, TextDocument, ThemeColor, Uri, window, workspace } from 'vscode'
import { mapDistinct, _Region, parseRegion } from '../shared'
import '../shared/extension'
import { Baser } from './Baser'
import { loadLogs } from './loadLogs'
import { Panel } from './Panel'

declare module 'vscode' {
	interface Diagnostic {
		_result: Result
	}
}

export const regionToSelection = (doc: TextDocument, region: _Region) => {
	return Array.isArray(region)
		? (region.length === 4
			? new Selection(...region)
			: (() => {
				const [byteOffset, byteLength] = region
				const startColRaw = byteOffset % 16
				const endColRaw = (byteOffset + byteLength) % 16
				return new Selection(
					Math.floor(byteOffset / 16),
					10 + startColRaw + Math.floor(startColRaw / 2),
					Math.floor((byteOffset + byteLength) / 16),
					10 + endColRaw + Math.floor(endColRaw / 2),
				)
			})())
		: (() => {
			const line = doc.lineAt(region)
			return new Selection(
				line.range.start.line,
				line.firstNonWhitespaceCharacterIndex,
				line.range.end.line,
				line.range.end.character,
			)
		})()
	}

export class Store {
	static extensionPath: string | undefined
	static globalState: Memento

	@observable.shallow logs = [] as Log[]
	@computed public get results() {
		const runs = this.logs.map(log => log.runs).flat()
		return runs.map(run => run.results).flat()
	}
	@computed public get distinctArtifactNames() {
		const fileAndUris = this.logs.map(log => [...log._distinct.entries()]).flat()
		return mapDistinct(fileAndUris)
	}

	constructor() {
		intercept(this.logs, objChange => {
			const change = objChange as unknown as IArrayWillSplice<Log>
			change.added = change.added.filter(log => this.logs.every(existing => existing._uri !== log._uri))
			return objChange
		})
	}
}

export async function activate(context: ExtensionContext) {
	const disposables = context.subscriptions
	Store.extensionPath = context.extensionPath
	Store.globalState = context.globalState
	disposables.push(commands.registerCommand('sarif.clearState', () => {
		context.globalState.update('view', undefined)
		commands.executeCommand('workbench.action.reloadWindow')
	}))
	const store = new Store()

	// Boot
	const uris = await workspace.findFiles('.sarif/**/*.sarif')
	store.logs.push(...await loadLogs(uris))

	// Basing
	const urisNonSarif = await workspace.findFiles('**/*', '.sarif') // Ignore folders?
	const fileAndUris = urisNonSarif.map(uri => [uri.path.split('/').pop(), uri.path])  as [string, string][]
	const baser = new Baser(mapDistinct(fileAndUris), store)

	// Panel
	const panel = new Panel(context, baser, store)
	if (uris.length) await panel.show()
	disposables.push(commands.registerCommand('sarif.showPanel', () => panel.show()))

	// Suggest In-Project Sarif Files
	;(async () => {
		const urisSarifInWorkspace = await workspace.findFiles('**/*.sarif', '.sarif/**/*.sarif')
		const count = urisSarifInWorkspace.length
		if (!count) return
		if (await window.showInformationMessage(`Discovered ${count} SARIF logs in your workspace.`, 'View in SARIF Panel')) {
			store.logs.push(...await loadLogs(urisSarifInWorkspace))
			panel.show()
		}
	})() // Enabled Temporarily.

	// Diagnostics
	const diagsAll = languages.createDiagnosticCollection('sarif')
	const setDiags = (doc: TextDocument) => {
		if (doc.fileName.endsWith('.git')) return
		const artifactPath = baser.translateLocalToArtifact(doc.uri.path)
		const diags = store.results
			.filter(result => result._uri === artifactPath)
			.map(result => ({
				_result: result,
				message: result._message,
				range: regionToSelection(doc, result._region),
				severity: {
						error: DiagnosticSeverity.Error,
						warning: DiagnosticSeverity.Warning,
					}[result.level] ?? DiagnosticSeverity.Information // note, none, undefined.
			}) )
		diagsAll.set(doc.uri, diags)
	}
	workspace.textDocuments.forEach(setDiags)
	workspace.onDidOpenTextDocument(setDiags)
	workspace.onDidCloseTextDocument(doc => diagsAll.delete(doc.uri)) // Spurious *.git deletes don't hurt.
	observe(store.logs, change => workspace.textDocuments.forEach(setDiags))

	// Open Documents <-sync-> Store.logs
	const syncActiveLog = async (doc: TextDocument) => {
		if (!doc.fileName.match(/\.sarif$/i)) return
		if (store.logs.some(log => log._uri === doc.uri.toString())) return
		store.logs.push(...await loadLogs([doc.uri]))
		panel.show()
	}
	workspace.textDocuments.forEach(syncActiveLog)
	workspace.onDidOpenTextDocument(syncActiveLog)
	workspace.onDidCloseTextDocument(doc => {
		if (!doc.fileName.match(/\.sarif$/i)) return
		store.logs.removeWhere(log => log._uri === doc.uri.toString())
	})

	// Actions/Decorations for Call Trees
	const decorationTypeCallout = window.createTextEditorDecorationType({
		after: { color: new ThemeColor('problemsWarningIcon.foreground') }
	})
	const decorationTypeHighlight = window.createTextEditorDecorationType({
		border: '1px',
		borderStyle: 'solid',
		borderColor: new ThemeColor('problemsWarningIcon.foreground'),
	})
	languages.registerCodeActionsProvider('*', {
		provideCodeActions: (doc, _range, context) => {
			if (context.only) return
			const result = context.diagnostics[0]?._result
			panel.select(result)

			const editor = window.visibleTextEditors.find(editor => editor.document === doc)
			if (!editor) return // When would editor be undef?
			if (!result) return // Don't clear the decorations until the next result is selected.

			const locations = result?.codeFlows?.[0]?.threadFlows?.[0]?.locations ?? []
			const messages = locations.map((tfl, i) => {
				const text = tfl.location?.message?.text
				return `Step ${i + 1}${text ? `: ${text}` : ''}`
			})
			const ranges = locations.map(tfl => regionToSelection(doc, parseRegion(tfl.location?.physicalLocation?.region)))
			const rangesEnd = ranges.map(range => {
				const endPos = doc.lineAt(range.end.line).range.end
				return new Range(endPos, endPos)
			})
			const rangesEndAdj = rangesEnd.map(range => {
				const tabCount = doc.lineAt(range.end.line).text.match(/\t/g)?.length ?? 0
				const tabCharAdj = tabCount * (editor.options.tabSize as number - 1) // Intra-character tabs are counted wrong.
				return range.end.character + tabCharAdj
			})
			const maxRangeEnd = Math.max(...rangesEndAdj) + 2 // + for Padding
			const decorCallouts = rangesEnd.map((range, i) => ({
				range,
				hoverMessage: messages[i],
				renderOptions: { after: { contentText: ` ${'┄'.repeat(maxRangeEnd - rangesEndAdj[i])} ${messages[i]}`, } }, // ←
			}))
			editor.setDecorations(decorationTypeCallout, decorCallouts)
			editor.setDecorations(decorationTypeHighlight, ranges)
			return []
		}
	})

	// Virtual Documents
	workspace.registerTextDocumentContentProvider('sarif', {
		provideTextDocumentContent: (uri, token) => {
			const [logUriEncoded, runIndex, artifactIndex] = uri.path.split('/')
			const logUri = decodeURIComponent(logUriEncoded)
			const artifact = store.logs.find(log => log._uri === logUri)?.runs[runIndex]?.artifacts?.[artifactIndex]
			const contents = artifact?.contents
			if (contents?.text) return contents?.text
			if (contents?.binary) {
				const lines = Buffer.from(contents?.binary, 'base64').toString('hex').match(/.{1,32}/g)
				return lines.reduce((sum, line, i) => {
					const lineNo = ((i + 128) * 16).toString(16).toUpperCase().padStart(8, '0')
					const preview = Buffer.from(line, 'hex').toString('utf8').replace(/(\x09|\x0A|\x0B|\x0C|\x0D|\x1B)/g, '?')
					return `${sum}${lineNo}  ${line.toUpperCase().match(/.{1,2}/g).join(' ')}  ${preview}\n`
				}, '')
			}
			token.isCancellationRequested = true
		}
	})

	// API
	commands.registerCommand('sarif.apiOpenLogs', async () => {
		const sarifExt = extensions.getExtension('Jeff.sarif-vscode')
		if (!sarifExt.isActive) await sarifExt.activate()
		await sarifExt.exports.openLogs([
			Uri.file('/Users/jeff/projects/sarif-tutorials/samples/3-Beyond-basics/automation-details.sarif'),
			Uri.file('/Users/jeff/projects/sarif-tutorials/samples/3-Beyond-basics/bad-eval-related-locations.sarif'),
			Uri.file('/Users/jeff/projects/sarif-tutorials/samples/3-Beyond-basics/bad-eval-with-code-flow.sarif'),
		])
	})
	commands.registerCommand('sarif.apiCloseLogs', async () => {
		const sarifExt = extensions.getExtension('Jeff.sarif-vscode')
		if (!sarifExt.isActive) await sarifExt.activate()
		await sarifExt.exports.closeLogs([
			Uri.file('/Users/jeff/projects/sarif-tutorials/samples/3-Beyond-basics/automation-details.sarif'),
		])
	})
	commands.registerCommand('sarif.apiCloseAllLogs', async () => {
		const sarifExt = extensions.getExtension('Jeff.sarif-vscode')
		if (!sarifExt.isActive) await sarifExt.activate()
		await sarifExt.exports.closeAllLogs()
	})
	return {
		async openLogs(logs: Uri[]) {
			store.logs.push(...await loadLogs(logs))
		},
		async closeLogs(logs: Uri[]) {
			for (const uri of logs) {
				store.logs.removeWhere(log => log._uri === uri.toString())
			}
		},
		async closeAllLogs() {
			store.logs.splice(0)
		},
		get uriBases() {
			return baser.uriBases.map(path => Uri.file(path)) as ReadonlyArray<Uri>
		},
		set uriBases(values) {
			baser.uriBases = values.map(uri => uri.path)
		},
	}
}

export function deactivate() {}
