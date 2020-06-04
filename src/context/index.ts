// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IArraySplice, observe } from 'mobx'
import { Log } from 'sarif'
import { CancellationToken, commands, DiagnosticSeverity, ExtensionContext, languages, Range, TextDocument, ThemeColor, Uri, window, workspace } from 'vscode'
import { mapDistinct, parseRegion } from '../shared'
import '../shared/extension'
import { Baser } from './Baser'
import { loadLogs } from './loadLogs'
import { Panel } from './Panel'
import { regionToSelection } from './regionToSelection'
import { ResultDiagnostic } from './ResultDiagnostic'
import { Store } from './Store'

export async function activate(context: ExtensionContext) {
	const disposables = context.subscriptions
	Store.extensionPath = context.extensionPath
	Store.globalState = context.globalState
	disposables.push(commands.registerCommand('sarif.clearState', () => {
		context.globalState.update('view', undefined)
		commands.executeCommand('workbench.action.reloadWindow')
	}))
	const store = new Store()

	// Basing
	const urisNonSarif = await workspace.findFiles('**/*', '.sarif') // Ignore folders?
	const fileAndUris = urisNonSarif.map(uri => [uri.path.split('/').pop(), uri.path]) as [string, string][]
	const baser = new Baser(mapDistinct(fileAndUris), store)

	// Panel
	const panel = new Panel(context, baser, store)
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
	}) // Disabled while we evaluate the future of this feature.

	// Diagnostics
	const diagsAll = languages.createDiagnosticCollection('SARIF')
	const setDiags = (doc: TextDocument) => {
		if (doc.fileName.endsWith('.git')) return
		const artifactPath = baser.translateLocalToArtifact(doc.uri.path)
		const severities = {
			error: DiagnosticSeverity.Error,
			warning: DiagnosticSeverity.Warning,
		} as Record<string, DiagnosticSeverity>
		const diags = store.results
			.filter(result => result._uri === artifactPath)
			.map(result => new ResultDiagnostic(
				regionToSelection(doc, result._region),
				result._message ?? '—',
				severities[result.level ?? ''] ?? DiagnosticSeverity.Information, // note, none, undefined.
				result,
			))
		diagsAll.set(doc.uri, diags)
	}
	workspace.textDocuments.forEach(setDiags)
	workspace.onDidOpenTextDocument(setDiags)
	workspace.onDidCloseTextDocument(doc => diagsAll.delete(doc.uri)) // Spurious *.git deletes don't hurt.
	observe(store.logs, () => workspace.textDocuments.forEach(setDiags))

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

			const diagnostic = context.diagnostics[0] as ResultDiagnostic | undefined
			if (!diagnostic) return

			const result = diagnostic?.result
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
	observe(store.logs, change => {
		const {removed} = change as unknown as IArraySplice<Log>
		if (!removed.length) return
		window.visibleTextEditors.forEach(editor => {
			editor.setDecorations(decorationTypeCallout, [])
			editor.setDecorations(decorationTypeHighlight, [])
		})
	})

	// Virtual Documents
	workspace.registerTextDocumentContentProvider('sarif', {
		provideTextDocumentContent: (uri, token) => {
			const [logUriEncoded, runIndex, artifactIndex] = uri.path.split('/')
			const logUri = decodeURIComponent(logUriEncoded)
			const artifact = store.logs.find(log => log._uri === logUri)?.runs[+runIndex]?.artifacts?.[+artifactIndex]
			const contents = artifact?.contents
			if (contents?.text) return contents?.text
			if (contents?.binary) {
				const lines = Buffer.from(contents?.binary, 'base64').toString('hex').match(/.{1,32}/g) ?? []
				return lines.reduce((sum, line, i) => {
					const lineNo = ((i + 128) * 16).toString(16).toUpperCase().padStart(8, '0')
					const preview = Buffer.from(line, 'hex').toString('utf8').replace(/(\x09|\x0A|\x0B|\x0C|\x0D|\x1B)/g, '?')
					return `${sum}${lineNo}  ${line.toUpperCase().match(/.{1,2}/g)?.join(' ')}  ${preview}\n`
				}, '')
			}
			token.isCancellationRequested = true
			return ''
		}
	})

	// API
	return {
		async openLogs(logs: Uri[], _options: any, cancellationToken?: CancellationToken) {
			store.logs.push(...await loadLogs(logs, cancellationToken))
			if (cancellationToken?.isCancellationRequested) return
			if (store.results.length) panel.show()
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
