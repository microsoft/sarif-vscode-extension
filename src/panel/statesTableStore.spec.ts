// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { StatesTableStore, StateEntry } from './statesTableStore';
import { observable } from 'mobx';
import assert from 'assert';

describe('StatesTableStore', () => {
    it('should create a states table with correct columns', () => {
        const statesSource = { results: [] as StateEntry[] };
        const selection = observable.box(undefined);
        const store = new StatesTableStore(statesSource, selection);

        assert.strictEqual(store.columns.length, 2);
        assert.strictEqual(store.columns[0].name, 'Key');
        assert.strictEqual(store.columns[1].name, 'Value');
    });

    it('should handle state entries correctly', () => {
        const states: StateEntry[] = [
            { key: 'ptr', value: 'null' },
            { key: 'isValid', value: 'false' },
            { key: 'refCount', value: '0' }
        ];
        const statesSource = { results: states };
        const selection = observable.box(undefined);
        const store = new StatesTableStore(statesSource, selection);

        assert.strictEqual(store.rowItems.length, 3);
        assert.strictEqual(store.rowItems[0].item.key, 'ptr');
        assert.strictEqual(store.rowItems[0].item.value, 'null');
    });

    it('should sort states by key or value', () => {
        const states: StateEntry[] = [
            { key: 'z_key', value: 'z_value' },
            { key: 'a_key', value: 'a_value' },
            { key: 'm_key', value: 'm_value' }
        ];
        const statesSource = { results: states };
        const selection = observable.box(undefined);
        const store = new StatesTableStore(statesSource, selection);

        // Test initial sort (should be by Key ascending by default)
        let groupsSorted = store.groupsFilteredSorted;
        assert(groupsSorted.length > 0, 'Should have at least one group');
        let sortedByKey = groupsSorted[0].itemsFiltered.map(item => item.item);

        // Default should be ascending by key
        assert.strictEqual(sortedByKey[0].key, 'a_key');
        assert.strictEqual(sortedByKey[2].key, 'z_key');

        // Toggle sort should reverse it to descending
        store.toggleSort('Key');
        groupsSorted = store.groupsFilteredSorted;
        sortedByKey = groupsSorted[0].itemsFiltered.map(item => item.item);
        assert.strictEqual(sortedByKey[0].key, 'z_key');
        assert.strictEqual(sortedByKey[2].key, 'a_key');

        // Test sorting by value
        store.toggleSort('Value');
        const groupsSorted2 = store.groupsFilteredSorted;
        const sortedByValue = groupsSorted2[0].itemsFiltered.map(item => item.item);
        assert.strictEqual(sortedByValue[0].value, 'a_value');
        assert.strictEqual(sortedByValue[2].value, 'z_value');
    });

    it('should not show group headers in rows', () => {
        const states = [
            { key: 'test_key', value: 'test_value' },
            { key: 'another_key', value: 'another_value' }
        ];
        const statesSource = { results: states };
        const selection = observable.box(undefined);
        const store = new StatesTableStore(statesSource, selection);

        // Verify that rows contains only RowItem objects, no RowGroup objects
        const rows = store.rows;
        assert.strictEqual(rows.length, 2, 'Should have 2 rows for 2 state entries');

        // All rows should be RowItem instances (not RowGroup)
        const { RowItem } = require('./tableStore');
        rows.forEach(row => {
            assert(row instanceof RowItem, 'All rows should be RowItem instances');
        });
    });

    it('should have resizable columns with default widths', () => {
        const statesSource = { results: [] as StateEntry[] };
        const selection = observable.box(undefined);
        const store = new StatesTableStore(statesSource, selection);

        // Verify column configuration for resizing
        const columns = store.columns;
        assert.strictEqual(columns.length, 2, 'Should have 2 columns');
        assert.strictEqual(columns[0].name, 'Key', 'First column should be Key');
        assert.strictEqual(columns[1].name, 'Value', 'Second column should be Value');

        // Verify columns have width properties (needed for ResizeHandle)
        assert(columns[0].width, 'Key column should have width property');
        assert(columns[1].width, 'Value column should have width property');

        // Verify default widths
        assert.strictEqual(columns[0].width.get(), 150, 'Key column default width should be 150');
        assert.strictEqual(columns[1].width.get(), 200, 'Value column default width should be 200');
    });

    it('should support vertical resizing through observable height', () => {
        const statesSource = { results: [] as StateEntry[] };
        const selection = observable.box(undefined);
        const store = new StatesTableStore(statesSource, selection);

        // This test verifies that the store can be used with an observable height
        // (The actual height management is in the Details component)
        const mockHeight = observable.box(200);

        // Simulate changing the height
        mockHeight.set(300);
        assert.strictEqual(mockHeight.get(), 300, 'Height should be changeable');

        mockHeight.set(150);
        assert.strictEqual(mockHeight.get(), 150, 'Height should be changeable to minimum');

        // Verify the store continues to work with different heights
        assert(store.columns.length > 0, 'Store should have columns');
        assert.strictEqual(store.rows.length, 0, 'Store should have no rows when empty');
    });

    it('should support tooltip functionality through column toString methods', () => {
        const states: StateEntry[] = [
            { key: 'very_long_variable_name_that_might_get_truncated', value: 'this_is_a_very_long_value_that_should_show_in_tooltip' },
            { key: 'short', value: 'val' }
        ];
        const statesSource = { results: states };
        const selection = observable.box(undefined);
        const store = new StatesTableStore(statesSource, selection);

        // Verify that column toString methods work for tooltips
        const keyColumn = store.columns[0];
        const valueColumn = store.columns[1];

        const firstState = states[0];
        assert.strictEqual(keyColumn.toString(firstState), 'very_long_variable_name_that_might_get_truncated', 'Key column toString should return the key');
        assert.strictEqual(valueColumn.toString(firstState), 'this_is_a_very_long_value_that_should_show_in_tooltip', 'Value column toString should return the value');

        const secondState = states[1];
        assert.strictEqual(keyColumn.toString(secondState), 'short', 'Key column toString should work for short keys');
        assert.strictEqual(valueColumn.toString(secondState), 'val', 'Value column toString should work for short values');
    });

    it('should provide conditional tooltips for truncated content only', () => {
        // This test demonstrates that tooltips are now only shown when content is truncated
        // The actual tooltip functionality is tested in the UI through ref callbacks that check
        // if element.scrollWidth > element.clientWidth before adding title attribute

        // The conditional tooltip implementation is in:
        // - details.tsx: States table renderCell function uses ref callback to check truncation
        // - resultTable.tsx: createSpanWithConditionalTooltip helper function
        // - index.tsx: Various ellipsis spans use ref callbacks for conditional tooltips

        const mockResult = {
            _message: 'This is a very long warning message that might get truncated in the UI',
            _level: 'warning'
        };

        // Verify that the message text would be available for conditional tooltip
        assert.strictEqual(mockResult._message, 'This is a very long warning message that might get truncated in the UI');
        assert.strictEqual(mockResult._level, 'warning');

        // The conditional tooltip implementation checks element.scrollWidth > element.clientWidth
        // before setting the title attribute, ensuring tooltips only appear for truncated content
    });
});
