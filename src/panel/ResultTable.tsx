// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { observer } from 'mobx-react'
import * as React from 'react'
import { PureComponent, ReactNode } from 'react'
import { Result } from 'sarif'
import { renderMessageWithEmbeddedLinks } from './widgets'
import { ResultTableStore } from './ResultTableStore'
import { Table } from './Table'
import { Column } from './TableStore'

const levelToIcon = {
	error: 'error',
	warning: 'warning',
	note: 'info',
	none: 'issues',
	undefined: 'question',
}

interface ResultTableProps<G> {
	store: ResultTableStore<G>
	onClearFilters: () => void
	renderGroup: (group: G) => ReactNode
}
@observer export class ResultTable<G> extends PureComponent<ResultTableProps<G>> {
	private renderCell = (column: Column<Result>, result: Result) => {
		const customRenderers = {
			'File':     result => <span title={result._uri}>{result._uri?.file ?? '—'}</span>,
			'Line':     result => <span>{result._line < 0 ? '—' : result._line}</span>,
			'Message':  result => <span>{renderMessageWithEmbeddedLinks(result, vscode.postMessage)}</span>,
			'Rule':     result => <>
				<span>{result._rule?.name ?? '—'}</span>
				<span className="svSecondary">{result.ruleId}</span>
			</>,
		}
		const defaultRenderer = result => { // Refactor
			const capitalize = str => `${str[0].toUpperCase()}${str.slice(1)}`
			return <span>{capitalize(column.toString(result))}</span>
		}
		const renderer = customRenderers[column.name] ?? defaultRenderer
		return renderer(result)
	}

	render() {
		const { store, onClearFilters, renderGroup } = this.props
		const { renderCell } = this
		return <Table columns={store.visibleColumns} store={store}
			renderIconName={result => levelToIcon[result.level]}
			renderGroup={renderGroup} renderCell={renderCell}>
			<div className="svZeroData">
				<span>No results found with provided filter criteria.</span>
				<div onClick={onClearFilters}>Clear Filters</div>
			</div>
		</Table>
	}
}
