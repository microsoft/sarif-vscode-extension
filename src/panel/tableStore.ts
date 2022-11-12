// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { action, computed, IObservableValue, observable } from 'mobx';
import '../shared/extension';

export class Column<T> {
    width: IObservableValue<number>
    constructor(
        readonly name: string,
        width: number,
        readonly toString: (item: T) => string,
        readonly toNumber?: (item: T) => number /* For sorting */) {
        this.width = observable.box(width);
    }
}

export abstract class Row {
    private static instances = 0
    public readonly key = Row.instances++
}

export class RowGroup<T, G> extends Row {
    private expandedState: IObservableValue<boolean>;
    get expanded() {
        return this.expandedState.get();
    }
    set expanded(value: boolean) {
        this.expandedState.set(value);
    }
    public items = [] as RowItem<T>[]
    public itemsFiltered = [] as RowItem<T>[]
    constructor(readonly title: G, expansionStates: Map<G, IObservableValue<boolean>>) {
        super();
        if (!expansionStates.has(title)) {
            expansionStates.set(title, observable.box(false));
        }
        this.expandedState = expansionStates.get(this.title)!;
    }
}

export class RowItem<T> extends Row {
    public group?: { expanded: boolean }
    constructor(readonly item: T) {
        super();
    }
}

enum SortDir {
    Asc = 'arrow-down',
    Dsc = 'arrow-up',
}

export class TableStore<T, G> {
    private expansionStates = new Map<G, IObservableValue<boolean>>();
    constructor(
        readonly groupBy: (item: T) => G | undefined,
        readonly itemsSource: { results: ReadonlyArray<T> }, // Abstraction break.
        readonly selection: IObservableValue<Row | undefined>) {
    }

    @computed({ keepAlive: true }) public get rowItems() {
        return this.itemsSource.results.map(result => new RowItem(result));
    }
    @computed({ keepAlive: true }) private get groups() {
        const map = new Map<G | undefined, RowGroup<T, G | undefined>>();
        this.rowItems.forEach(item => {
            const key = this.groupBy(item.item);
            if (!map.has(key)) map.set(key, new RowGroup(key, this.expansionStates));
            const group = map.get(key)!;
            group.items.push(item);
            item.group = group;
        });
        return [...map.values()].sortBy(g => g.items.length, true); // High to low.
    }

    // Unable to express "columns of any varying types" otherwise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get columns(): Column<any>[] { return []; }
    protected get filter() { return (_item: T) => true; }
    @observable public sortColumn = undefined as string | undefined
    @observable public sortDir = SortDir.Asc
    @action toggleSort(newCol: string) {
        if (this.sortColumn === newCol) {
            this.sortDir = this.sortDir === SortDir.Asc ? SortDir.Dsc : SortDir.Asc;
        } else {
            this.sortColumn = newCol;
            this.sortDir = SortDir.Asc;
        }
    }
    sort(items: RowItem<T>[]) {
        const {columns, sortColumn, sortDir} = this;
        const column = columns.find(col => col.name === sortColumn);
        if (!column) return;
        const {toNumber, toString} = column;
        const toSortable = toNumber ?? toString;
        items.sortBy(item => toSortable(item.item), sortDir === SortDir.Dsc);
    }

    @computed public get groupsFilteredSorted() {
        const {groups, filter} = this;
        for (const group of groups) {
            group.itemsFiltered = group.items.filter(item => filter?.(item.item) ?? true);
            this.sort(group.itemsFiltered);
        }
        return this.groups.filter(group => group.itemsFiltered.length);
    }
    @computed public get rows() {
        const rows = [] as Row[];
        for (const group of this.groupsFilteredSorted) {
            rows.push(group);
            if (group.expanded) rows.push(...group.itemsFiltered);
        }
        return rows;
    }

    select(item: T) {
        const row = this.rowItems.find(row => row.item === item);
        this.selection.set(row);
        if (row?.group) row.group.expanded = true;
    }

    isLineThrough(_item: T): boolean {
        return false;
    }

    menuContext(_item: T): Record<string, string> | undefined {
        return undefined;
    }
}
