// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { filtersColumn, filtersRow } from '../shared';
import { IndexStore } from './indexStore';
import { log, log2 } from '../test/mockLog';
import assert from 'assert';

describe('IndexStore', () => {
    it('updates the results as new logs are added', () => {
        const indexStore = new IndexStore({ filtersRow, filtersColumn });
        indexStore.logs.push(log);
        assert.strictEqual(indexStore.results.length, 1);
        assert.deepStrictEqual(indexStore.results.map((result) => result.message.text), ['Message 1']);

        indexStore.logs.push(log2);
        assert.strictEqual(indexStore.results.length, 2);
        assert.deepStrictEqual(indexStore.results.map((result) => result.message.text), ['Message 1', 'Message 2']);
    });
});
