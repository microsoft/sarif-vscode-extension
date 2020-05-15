// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computed, IObservableValue } from 'mobx'
import { Result } from 'sarif'
import { Column, Row, TableStore } from './TableStore'

export class ResultTableStore<G> extends TableStore<Result, G> {
	constructor(
		readonly groupName: string,
		readonly groupBy: (item: Result) => G,
		resultsSource: { results: ReadonlyArray<Result> },
		readonly filtersSource: { keywords, filtersRow, filtersColumn },
		readonly selection: IObservableValue<Row>) {
		super(
			groupBy,
			resultsSource,
			selection,
		)
		this.sortColumn = this.columnsPermanent[0].name
	}

	// Columns
	private columnsPermanent = [
		new Column<Result>('Line', 50, result => result._line + '', result => result._line ?? 0),
		new Column<Result>('File', 250, result => result._relativeUri),
		new Column<Result>('Message', 300, result => result._message),
	]
	private columnsOptional = [
		new Column<Result>('Baseline', 100, result => result.baselineState),
		new Column<Result>('Suppression', 100, result => result._suppression),
		new Column<Result>('Rule', 220, result => `${result._rule?.name ?? '—'} ${result.ruleId ?? '—'}`),
	]
	get columns() {
		return [...this.columnsPermanent, ...this.columnsOptional]
	}
	@computed get visibleColumns() {
		const {filtersColumn} = this.filtersSource
		const optionalColumnNames = Object.entries(filtersColumn.Columns)
			.filter(([_, state]) => state)
			.map(([name, ]) => name)
		return [
			...this.columnsPermanent.filter(col => col.name !== this.groupName),
			...this.columnsOptional.filter(col => optionalColumnNames.includes(col.name))
		]
	}

	protected get filter() {
		const {keywords, filtersRow} = this.filtersSource
		const {columns} = this
		const mapToList = record => Object.entries(record)
			.filter(([, value]) => value)
			.map(([label,]) => label.toLowerCase())

		const levels = mapToList(filtersRow.Level)
		const baselines = mapToList(filtersRow.Baseline)
		const suppressions = mapToList(filtersRow.Suppression)
		const filterKeywords = keywords.toLowerCase().split(/\s+/).filter(part => part)

		return (result: Result) => {
			if (!levels.includes(result.level)) return false
			if (!baselines.includes(result.baselineState)) return false
			if (!suppressions.includes(result._suppression)) return false
			return columns.some(col => {
				const isMatch = (field: string, keywords: string[]) => !keywords.length || keywords.some(keyword => field.includes(keyword))
				const toString = col.toString as any
				const field = toString(result).toLowerCase()
				return isMatch(field, filterKeywords)
			})
		}
	}
}
