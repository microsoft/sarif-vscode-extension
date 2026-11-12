// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computed, IObservableValue, observable } from 'mobx';
import { Column, Row, TableStore } from './tableStore';

// Represents a state key-value pair from ThreadFlowLocation.state
export interface StateEntry {
    key: string;
    value: string;
}

export class StatesTableStore extends TableStore<StateEntry, undefined> {
    constructor(
        readonly statesSource: { results: ReadonlyArray<StateEntry> },
        readonly selection: IObservableValue<Row | undefined>
    ) {
        super(
            () => undefined, // No grouping - all items in one default group
            statesSource,
            selection
        );
        this.sortColumn = this.columns[0].name; // Default sort by key
    }

    // Columns for the states table
    private statesColumns = [
        new Column<StateEntry>('Key', 150, state => state.key),
        new Column<StateEntry>('Value', 200, state => state.value),
    ]

    get columns() {
        return this.statesColumns;
    }

    // No filtering for states table
    protected get filter() {
        return () => true; // Show all states
    }

    // Override itemsSource to use our states source - not needed since we inherit from TableStore
    // The parent class will use this.itemsSource.results automatically

    // Override rows to skip group headers - we don't want grouping for states
    @computed public get rows() {
        const rows = [] as Row[];
        for (const group of this.groupsFilteredSorted) {
            // Skip adding the group header, just add the items directly
            rows.push(...group.itemsFiltered);
        }
        return rows;
    }
}
