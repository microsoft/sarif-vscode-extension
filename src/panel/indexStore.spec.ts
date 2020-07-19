// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { filtersColumn, filtersRow } from '../shared';
import { IndexStore } from './indexStore';
import { log, log2, log3 } from '../test/mockLog';
import assert from 'assert';

describe('IndexStore', () => {
    it('Keeps track of Log[] data and extract and flattens Result[] from it ', () => {
        const indexStore = new IndexStore({ filtersRow, filtersColumn });
        indexStore.logs.push(log);
        assert.strictEqual(indexStore.results.length, 1);
        assert.deepStrictEqual(indexStore.results.map((result) => result.message.text), ['Message 1']);
        indexStore.logs.push(log2);
        assert.strictEqual(indexStore.results.length, 2);
        assert.deepStrictEqual(indexStore.results.map((result) => result.message.text), ['Message 1', 'Message 2']);
    });
    it('Consists of 2 ResultTableStores grouped by artifact location and rule', () => {
        const indexStore = new IndexStore({ filtersRow, filtersColumn });
        indexStore.logs.push(log);
        assert.strictEqual(indexStore.resultTableStoreByLocation.rows.length, 2);
        assert.strictEqual(indexStore.resultTableStoreByRule.rows.length, 2);
        indexStore.logs.push(log2);
        assert.strictEqual(indexStore.resultTableStoreByLocation.rows.length, 4);
        assert.strictEqual(indexStore.resultTableStoreByRule.rows.length, 3);
    });
    it('can filter results based on keywords', () => {
        const indexStore = new IndexStore({ filtersRow, filtersColumn });
        indexStore.logs.push(log, log2, log3);
        assert.strictEqual(indexStore.resultTableStoreByLocation.groupsFilteredSorted.length, 3);
        assert.deepStrictEqual(indexStore.resultTableStoreByLocation.groupsFilteredSorted.map((rowGroup) => rowGroup.title), ['/file.txt', '/file_2.txt', '/file_3.txt']);
        indexStore.keywords = 'file_3';
        assert.strictEqual(indexStore.resultTableStoreByLocation.groupsFilteredSorted.length, 1);
        assert.deepStrictEqual(indexStore.resultTableStoreByLocation.groupsFilteredSorted.map((rowGroup) => rowGroup.title), ['/file_3.txt']);
        indexStore.clearFilters();
        assert.strictEqual(indexStore.resultTableStoreByLocation.groupsFilteredSorted.length, 3);
    });
});
