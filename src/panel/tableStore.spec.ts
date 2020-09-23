// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { TableStore, RowGroup } from './tableStore';
import { observable } from 'mobx';
import assert from 'assert';

describe('TableStore', () => {
    const groupBy = (item: number) => item % 2 === 0 ? 'even' : 'odd';
    const selection = observable.box();

    it.skip('should collapse and expand row groups', () => {
        const itemSource = { results: [1,2,3,4,5] };
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

    it ('should verify the default sorting for the row groups', () => {
        // tableStore - when # of odd elements more than # of even elements
        const itemSource = { results: [1,2,3,4,5] };
        const tableStore = new TableStore(groupBy, itemSource, selection);

        // "odd" row group would be sorted high in the list
        assert.strictEqual((tableStore.rows[0] as RowGroup<number,string>).title, 'odd');

        // tableStore - when # of even elements are more than # of odd elements
        const itemSource2 = { results: [1,2,3,4,5,6,8,10] };
        const tableStore2 = new TableStore(groupBy, itemSource2, selection);

        // "even" row group would be sorted high in the list
        assert.strictEqual((tableStore2.rows[0] as RowGroup<number,string>).title, 'even');
    });
});
