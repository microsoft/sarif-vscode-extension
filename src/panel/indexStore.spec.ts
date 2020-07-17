// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { filtersColumn, filtersRow } from '../shared';
import { IndexStore } from './indexStore';
import { log as mockResultTableStoreLog } from '../test/mockResultTableStore';
import { log as mockIndexStoreLog } from '../test/mockIndexStore';
import assert from 'assert';

describe('IndexStore', () => {
    it('updates the results as new logs are added', () => {
        const indexStore = new IndexStore({ filtersRow, filtersColumn });
        indexStore.logs.push(mockResultTableStoreLog);
        assert.strictEqual(indexStore.results.length, 6);
        assert.deepStrictEqual(indexStore.results.map((result) => result.message.text), ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5', 'Message 6']);

        indexStore.logs.push(mockIndexStoreLog);
        assert.strictEqual(indexStore.results.length, 9);
        assert.deepStrictEqual(indexStore.results.map((result) => result.message.text), ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5', 'Message 6', 'ResultIndexStore1', 'ResultIndexStore2', 'ResultIndexStore3']);
    });
    it('creates 1 ResultTableStore grouped by Location and updates it as new logs are added', () => {
        const indexStore = new IndexStore({ filtersRow, filtersColumn });
        indexStore.logs.push(mockResultTableStoreLog);
        assert.strictEqual(indexStore.resultTableStoreByLocation.rows.length, 9);
        indexStore.logs.push(mockIndexStoreLog);
        assert.strictEqual(indexStore.resultTableStoreByLocation.rows.length, 12);
    });
});
