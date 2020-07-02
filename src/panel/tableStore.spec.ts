// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { TableStore, RowGroup } from './tableStore';
import { observable } from 'mobx';
import { _Region } from '../shared';
import assert from 'assert';

describe('TableStore', () => {
    it('Get rows based on different values of expanded property', () => {
        // Create instance of tableStore
        const groupBy = (item: number) => item % 2 == 0 ? 'even' : 'odd';
        const itemSource = { results: [1,2,3,4,5] }
        const selection = observable.box(); 
        const tableStore = new TableStore(groupBy, itemSource, selection);
 
        // Verify rows based on default value for expanded property
        // TODO: compare 2 lists and their types?
        assert.strictEqual(tableStore.rows.length, 7);
        assert.strictEqual((tableStore.rows[0] as RowGroup<number,string>).title, 'odd');

        // Collapse "odd" group
        (tableStore.rows[0] as RowGroup<number,string>).expanded = false;
        assert.strictEqual(tableStore.rows.length, 4);

        // Expand "odd" group
        (tableStore.rows[0] as RowGroup<number,string>).expanded = true;
        assert.strictEqual(tableStore.rows.length, 7);

        // Collapse "even" group
        assert.strictEqual((tableStore.rows[4] as RowGroup<number,string>).title, 'even');
        (tableStore.rows[4] as RowGroup<number,string>).expanded = false;
        assert.strictEqual(tableStore.rows.length, 5);

        // Expand "even" group
        (tableStore.rows[4] as RowGroup<number,string>).expanded = true;
        assert.strictEqual(tableStore.rows.length, 7);

        // Collapse both "odd" and "even" group
        (tableStore.rows[0] as RowGroup<number,string>).expanded = false;
        assert.strictEqual(tableStore.rows.length, 4);
        (tableStore.rows[1] as RowGroup<number,string>).expanded = false;
        assert.strictEqual(tableStore.rows.length, 2);
    });
    it ('Row groups are sorted according to descending order of # of row items in them', () => {
        // tableStore - when # of odd elements more than # of even elements
        const groupBy = (item: number) => item % 2 == 0 ? 'even' : 'odd';
        const itemSource = { results: [1,2,3,4,5] }
        const selection = observable.box(); 
        const tableStore = new TableStore(groupBy, itemSource, selection);

        // "odd" row group would be sorted high in the list
        assert.strictEqual((tableStore.rows[0] as RowGroup<number,string>).title, 'odd');

        // tableStore - when # of even elements are more than # of odd elements
        const itemSource2 = { results: [1,2,3,4,5,6,8,10] }
        const tableStore2 = new TableStore(groupBy, itemSource2, selection);

        // "even" row group would be sorted high in the list
        assert.strictEqual((tableStore2.rows[0] as RowGroup<number,string>).title, 'even');
    })
    it ('Row groups maintain the same sequence of row items as it is in itemSource', () => {
        const groupBy = (item: number) => item % 2 == 0 ? 'even' : 'odd';
        const itemSource = { results: [1,2,3,4,5] }
        const selection = observable.box(); 
        const tableStore = new TableStore(groupBy, itemSource, selection);
        const oddRowGroup = tableStore.rows[0] as RowGroup<number, string>;
        assert.deepEqual(oddRowGroup.items.map((item) => item.item), [1,3,5]);

        const itemSource2 = { results: [5,4,3,2,1] }
        const tableStore2 = new TableStore(groupBy, itemSource2, selection);
        const oddRowGroup2 = tableStore2.rows[0] as RowGroup<number, string>;
        assert.deepEqual(oddRowGroup2.items.map((item) => item.item), [5,3,1]);

        const itemSource3 = { results: [21,4,19,2,13,1,5] }
        const tableStore3 = new TableStore(groupBy, itemSource3, selection);
        const oddRowGroup3 = tableStore3.rows[0] as RowGroup<number, string>;
        assert.deepEqual(oddRowGroup3.items.map((item) => item.item), [21,19,13,1,5]);
    });
    it('Effect of toggling sort', () => {
        const groupBy = (item: number) => item % 2 == 0 ? 'even' : 'odd';
        const itemSource = { results: [1,2,3,4,5] }
        const selection = observable.box(); 
        const tableStore = new TableStore(groupBy, itemSource, selection);

        // toggle sort
        tableStore.toggleSort('test_column_name');
        assert.strictEqual((tableStore.rows[0] as RowGroup<number, string>).title, 'odd');
        assert.strictEqual((tableStore.rows[4] as RowGroup<number, string>).title, 'even');
    })
});
