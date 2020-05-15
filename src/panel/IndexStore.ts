// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { action, computed, intercept, observable, observe, toJS, when } from 'mobx'
import { Log, PhysicalLocation, ReportingDescriptor, Result } from 'sarif'
import { augmentLog, filtersColumn, filtersRow, parseArtifactLocation, parseRegion } from '../shared'
import '../shared/extension'
import { ResultTableStore } from './ResultTableStore'
import { Row, RowItem } from './TableStore'

export class IndexStore {
	constructor(state, defaultSelection?: boolean) {
		this.filtersRow = state.filtersRow
		this.filtersColumn = state.filtersColumn
		const setState = () => {
			const {filtersRow, filtersColumn} = this
			const state = { filtersRow: toJS(filtersRow), filtersColumn: toJS(filtersColumn) }
			vscode.postMessage({ command: 'setState', state: JSON.stringify(state, null, '    ') })
			// PostMessage object key order unstable. Stringify is stable.
		}
		// Sadly unable to observe at the root.
		observe(this.filtersRow.Level, setState)
		observe(this.filtersRow.Baseline, setState)
		observe(this.filtersRow.Suppression, setState)
		observe(this.filtersColumn.Columns, setState)

		intercept(this.logs, (change: any) => {
			if (change.type !== 'splice') throw new Error(`Unexpected change type. ${change.type}`)
			change.added.forEach(augmentLog)
			return change
		})

		if (defaultSelection) {
			const store = this.resultTableStoreByLocation
			when(() => !!store.rows.length, () => {
				const item = store.rows.find(row => row instanceof RowItem) as RowItem<Result>
				this.selection.set(item)
			})
		}
	}

	// Results
	@observable.shallow public logs = [] as Log[]
	@computed private get runs() {
		return this.logs.map(log => log.runs).flat()
	}
	@computed public get results() {
		return this.runs.map(run => run.results || []).flat()
	}
	selection = observable.box(undefined as Row)
	resultTableStoreByLocation = new ResultTableStore('File', result => result._relativeUri, this, this, this.selection)
	resultTableStoreByRule     = new ResultTableStore('Rule', result => result._rule,        this, this, this.selection)

	// Filters
	@observable keywords = ''
	@observable filtersRow = filtersRow
	@observable filtersColumn = filtersColumn
	@action public clearFilters() {
		this.keywords = ''
		for (const column in this.filtersRow) {
			for (const value in this.filtersRow[column]) {
				this.filtersRow[column][value] = true
			}
		}
	}

	// Tabs
	tabs = [
		{ toString: () => 'Locations', store: this.resultTableStoreByLocation },
		{ toString: () => 'Rules', store: this.resultTableStoreByRule },
		{ toString: () => 'Logs', store: undefined },
	] as { store: ResultTableStore<string | ReportingDescriptor> }[]
	selectedTab = observable.box(this.tabs[0], { deep: false })

	// Messages
	@action.bound public async onMessage(event: MessageEvent) {
		// if (event.origin === 'http://localhost:8000') return
		if (!event.data) return // Ignore mysterious empty message
		if (event.data?.source) return // Ignore 'react-devtools-*'
		if (event.data?.type) return // Ignore 'webpackOk'

		const command = event.data?.command

		if (command === 'select') {
			const {id} = event.data // id undefined means deselect.
			if (!id) {
				this.selection.set(undefined)
			} else {
				const [logUri, runIndex, resultIndex] = id
				const result = this.logs.find(log => log._uri === logUri)?.runs[runIndex]?.results?.[resultIndex]
				if (!result) throw new Error('Unexpected: result undefined')
				this.selectedTab.get().store?.select(result)
			}
		}

		if (command === 'spliceLogs') {
			for (const uri of event.data.removed) {
				const i = this.logs.findIndex(log => log._uri === uri)
				if (i >= 0) this.logs.splice(i, 1)
			}
			for (const {uri, uriUpgraded, webviewUri} of event.data.added) {
				const response = await fetch(webviewUri)
				const log = await response.json() as Log
				log._uri = uri
				log._uriUpgraded = uriUpgraded
				this.logs.push(log)
			}
		}
	}
}

export async function postSelectArtifact(result: Result, ploc?: PhysicalLocation) {
	if (!ploc) return
	const log = result._log
	const logUri = log._uri
	const [uri, uriContent] = parseArtifactLocation(result, ploc?.artifactLocation)
	const region = parseRegion(ploc?.region)
	await vscode.postMessage({ command: 'select', logUri, uri: uriContent ?? uri, region })
}

export async function postSelectLog(result: Result) {
	await vscode.postMessage({ command: 'selectLog', id: result._id })
}
