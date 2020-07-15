// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Row } from './tableStore';
import { observable } from 'mobx';
import { _Region, filtersRow, filtersColumn } from '../shared';
import { ResultTableStore } from './resultTableStore';
import { log } from '../test/mockResultTableStore';
import assert from 'assert';

describe('ResultTableStore', () => {
    it('should verify the default columns', () => {
        const result1 = log.runs![0].results![0];
        const result2 = log.runs![0].results![1];
        const resultsSource = {
            results: [result1, result2]
        }
        const selection = observable.box<Row | undefined>(undefined)
        const filtersSource = {
            keywords: 'keyword1',
            filtersRow: filtersRow,
            filtersColumn: filtersColumn
        }
        const resultTableStore = new ResultTableStore('File', result => result._relativeUri, resultsSource, filtersSource, selection)

        assert.strictEqual(resultTableStore.columns.length, 6);
        assert.strictEqual(resultTableStore.columns[0].name, 'Line')
        assert.strictEqual(resultTableStore.columns[1].name, 'File')
        assert.strictEqual(resultTableStore.columns[2].name, 'Message')
        assert.strictEqual(resultTableStore.columns[3].name, 'Baseline')
        assert.strictEqual(resultTableStore.columns[4].name, 'Suppression')
        assert.strictEqual(resultTableStore.columns[5].name, 'Rule')
    });
});
r