// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { action, computed } from 'mobx';
import { observer } from 'mobx-react';
import * as React from 'react';
import { KeyboardEvent, memo, PureComponent, ReactNode } from 'react';
import { Badge, css, Hi, Icon, ResizeHandle } from './widgets';
import './table.scss';
import { Column, RowGroup, RowItem, TableStore } from './tableStore';

interface TableProps<T, G> {
    columns: Column<T>[];
    renderIconName?: (item: T) => string;
    renderGroup: (group: G) => ReactNode;
    renderCell: (column: Column<T>, itemData: T) => ReactNode;
    store: TableStore<T, G>;
}
@observer export class Table<T, G> extends PureComponent<TableProps<T, G>> {
    @computed get gridTemplateColumns() {
        const {columns} = this.props;
        return [
            '34px', // Left margin. Aligns with tabs left margin (22px) + group chevron (12px).
            // Variable number of columns set to user-desired width.
            // First column has an extra 22px allowance for the `level` icon.
            ...columns.map((col, i) => `${(i === 0 ? 22 : 0) + col.width.get()}px`),
            '1fr', // Fill remaining space so the the selection/hover highlight doesn't look funny.
        ].join(' ');
    }

    private TableItem = memo<{ isLineThrough: boolean, isSelected: boolean, item: RowItem<T>, gridTemplateColumns: string, menuContext: Record<string, string> | undefined }>(props => {
        const { columns, store, renderIconName, renderCell } = this.props;
        const { isLineThrough, isSelected, item, gridTemplateColumns, menuContext } = props;
        return <div className={css('svTableRow', 'svTableRowItem', isLineThrough && 'svLineThrough', isSelected && 'svItemSelected')} style={{ gridTemplateColumns }}
            data-vscode-context={JSON.stringify(menuContext)}
            ref={ele => { // TODO: ForwardRef for Group
                if (!isSelected || !ele) return;
                setTimeout(() => ele.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); // requestAnimationFrame not working.
            }}
            onClick={e => {
                e.stopPropagation();
                store.selection.set(item);
            }}>
            <div></div>
            {columns.map((col, i) => <Hi key={i} className="svTableCell"
                style={i === columns.length - 1 ? { gridColumn: 'auto / span 2' } : {}}>
                {i === 0 && renderIconName && <Icon name={renderIconName(item.item)} />}
                {renderCell(col, item.item)}
            </Hi>)}
        </div>;
    })

    render() {
        const {TableItem} = this;
        const {columns, store, renderGroup, children} = this.props;
        const {rows, selection} = store;
        return !rows.length
            ? children // Zero data.
            : <div className="svTable" data-vscode-context='{"preventDefaultContextMenuItems": true}'>
                <div className="svTableHeader" style={{ gridTemplateColumns: this.gridTemplateColumns }}>
                    <div></div>
                    {columns.map(col => <div key={col.name} tabIndex={0} className="svTableCell"
                        onClick={action(() => store.toggleSort(col.name))}>
                        {col.name}{/* No spacing */}
                        {store.sortColumn === col.name && <Icon title="Sort" name={store.sortDir} />}
                        <ResizeHandle size={col.width} horizontal />
                    </div>)}
                </div>
                <div tabIndex={0} className={css('svTableBody', selection.get() && 'svSelected')} onKeyDown={this.onKeyDown}>
                    {rows.map(row => {
                        const isSelected = selection.get() === row;
                        if (row instanceof RowGroup) {
                            return <Hi key={row.key} className={css('svTableRow', 'svTableRowGroup', 'svTableCell', isSelected && 'svItemSelected')}
                                onClick={e => {
                                    e.stopPropagation();
                                    selection.set(row);
                                    row.expanded = !row.expanded;
                                }}>
                                <div style={{ width: 6 }}></div>
                                <Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} />
                                {renderGroup(row.title)}
                                <Badge text={row.itemsFiltered.length} />
                            </Hi>;
                        }
                        if (row instanceof RowItem) {
                            // Must evaluate isLineThrough outside of <TableItem /> so the function component knows to update.
                            return <TableItem key={row.key}
                                isLineThrough={store.isLineThrough(row.item)}
                                isSelected={isSelected}
                                item={row}
                                gridTemplateColumns={this.gridTemplateColumns}
                                menuContext={store.menuContext(row.item)} />;
                        }
                        return undefined; // Closed system: No other types expected.
                    })}
                </div>
            </div>;
    }

    @action.bound private onKeyDown(e: KeyboardEvent<Element>) {
        const {store} = this.props;
        const {rows, selection} = store;
        const index = rows.indexOf(selection.get()); // Rows
        const handlers = {
            ArrowUp: () => selection.set(rows[index - 1] ?? rows[index] ?? rows[0]),
            ArrowDown: () => selection.set(rows[index + 1] ?? rows[index]),
            Escape: () => selection.set(undefined)
        } as Record<string, () => void>;
        const handler = handlers[e.key];
        if (handler) {
            e.stopPropagation();
            e.preventDefault(); // Prevent scrolling.
            handler();
        }
    }
}
