// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computed, IObservableValue } from 'mobx';
import { Result } from 'sarif';
import { Visibility } from '../shared';
import { IndexStore } from './indexStore';
import { Column, Row, TableStore } from './tableStore';
import { renderRegionLocationText } from '../extension/regionLocationText';

export class ResultTableStore<G> extends TableStore<Result, G> {
    constructor(
        readonly groupName: string,
        readonly groupBy: (item: Result) => G | undefined,
        private readonly resultsSource: Pick<IndexStore, 'results' | 'resultsFixed'>,
        readonly filtersSource: {
            keywords: string;
            filtersRow: Record<string, Record<string, Visibility>>;
            filtersColumn: Record<string, Record<string, Visibility>>;
        },
        readonly selection: IObservableValue<Row | undefined>) {
        super(
            groupBy,
            resultsSource,
            selection,
        );
        this.sortColumn = this.columnsPermanent[0].name;
    }

    // Columns
    private columnsPermanent = [
        new Column<Result>('Start : End', 100, result => renderRegionLocationText(result._region), result => this.makeSortValue(result)),
        new Column<Result>('File', 250, result => result._relativeUri ?? ''),
        new Column<Result>('Message', 300, result => result._message ?? ''),
    ]
    private columnsOptional = [
        new Column<Result>('Baseline', 100, result => result.baselineState ?? ''),
        new Column<Result>('Suppression', 100, result => result._suppression ?? ''),
        new Column<Result>('Rule', 220, result => `${result._rule?.name ?? '—'} ${result.ruleId ?? '—'}`),
    ]
    get columns() {
        return [...this.columnsPermanent, ...this.columnsOptional];
    }
    @computed get visibleColumns() {
        const {filtersColumn} = this.filtersSource;
        const optionalColumnNames = Object.entries(filtersColumn.Columns)
            .filter(([_, state]) => state)
            .map(([name, ]) => name);
        return [
            ...this.columnsPermanent.filter(col => col.name !== this.groupName),
            ...this.columnsOptional.filter(col => optionalColumnNames.includes(col.name))
        ];
    }

    protected get filter() {
        const {keywords, filtersRow} = this.filtersSource;
        const {columns} = this;
        const mapToList = (record: Record<string, Visibility>) => Object.entries(record)
            .filter(([, value]) => value)
            .map(([label,]) => label.toLowerCase());

        const levels = mapToList(filtersRow.Level);
        const baselines = mapToList(filtersRow.Baseline);
        const suppressions = mapToList(filtersRow.Suppression);
        const filterKeywords = keywords.toLowerCase().split(/\s+/).filter(part => part);

        return (result: Result) => {
            if (!levels.includes(result.level ?? '')) return false;
            if (!baselines.includes(result.baselineState ?? '')) return false;
            if (!suppressions.includes(result._suppression ?? '')) return false;
            return columns.some(col => {
                const isMatch = (field: string, keywords: string[]) => !keywords.length || keywords.some(keyword => field.includes(keyword));
                const {toString} = col;
                const field = toString(result).toLowerCase();
                return isMatch(field, filterKeywords);
            });
        };
    }

    private makeSortValue(result: Result): number {
        if (!result._region) { return 0; }

        if (result._region.startLine !== undefined) {
            const line = result._region.startLine ?? 0;
            const col = result._region.startColumn ?? 0;
            return line * 10000000 + col;
        }

        if (result._region.charOffset !== undefined) {
            return result._region.charOffset * 10000000;
        }

        if (result._region.byteOffset !== undefined) {
            return result._region.byteOffset * 10000000;
        }

        return 0;
    }

    public isLineThrough(result: Result): boolean {
        return this.resultsSource.resultsFixed.includes(JSON.stringify(result._id));
    }

    public menuContext(result: Result): Record<string, string> | undefined {
        // If no alertNumber, then don't show the context menu (which contains the Dismiss Alert commands).
        if (!result.properties?.['github/alertNumber']) return undefined;

        return { resultId: JSON.stringify(result._id) };
    }
}
