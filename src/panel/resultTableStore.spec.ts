// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Row, RowGroup } from './tableStore';
import { observable } from 'mobx';
import { _Region, filtersRow, filtersColumn } from '../shared';
import { ResultTableStore } from './resultTableStore';
import { log } from '../test/mockResultTableStore';
import assert from 'assert';
import { Result } from 'sarif';

describe('ResultTableStore', () => {
    const resultsSource = { results: log.runs![0].results! }
    const selection = observable.box<Row | undefined>(undefined)
    const filtersSource = {
        keywords: '',
        filtersRow: filtersRow,
        filtersColumn: filtersColumn
    }

    it('should verify the default columns', () => {
        const resultTableStore = new ResultTableStore('File', result => result._relativeUri, resultsSource, filtersSource, selection)
        assert.strictEqual(resultTableStore.columns.length, 6);
        assert.strictEqual(resultTableStore.columns[0].name, 'Line')
        assert.strictEqual(resultTableStore.columns[1].name, 'File')
        assert.strictEqual(resultTableStore.columns[2].name, 'Message')
        assert.strictEqual(resultTableStore.columns[3].name, 'Baseline')
        assert.strictEqual(resultTableStore.columns[4].name, 'Suppression')
        assert.strictEqual(resultTableStore.columns[5].name, 'Rule')
    });

    it('should verify the visible columns', () => {
        const resultTableStore1 = new ResultTableStore('File', result => result._relativeUri, resultsSource, filtersSource, selection)
        assert.strictEqual(resultTableStore1.visibleColumns.length, 2);
        assert.strictEqual(resultTableStore1.visibleColumns.filter((col) => col.name == 'Line' || 'Message').length, 2);

        const resultTableStore2 = new ResultTableStore('Line', result => result._line, resultsSource, filtersSource, selection)
        assert.strictEqual(resultTableStore2.visibleColumns.length, 2);
        assert.strictEqual(resultTableStore2.visibleColumns.filter((col) => col.name == 'File' || 'Message').length, 2);

        const resultTableStore3 = new ResultTableStore('Message', result => result._message, resultsSource, filtersSource, selection)
        assert.strictEqual(resultTableStore3.visibleColumns.length, 2);
        assert.strictEqual(resultTableStore3.visibleColumns.filter((col) => col.name == 'File' || 'Line').length, 2);
    });

    it ('should verify the grouping of row items', () => {
        const groupBy = (result: Result) => result.locations ? result.locations[0].physicalLocation?.artifactLocation?.uri === '/folder/file_1.txt' ? 'file_1' : 'non file_1' : undefined;
        const resultTableStore = new ResultTableStore('File', groupBy, resultsSource, filtersSource, selection);
        assert.strictEqual(resultTableStore.rows.length, 0);
        assert.strictEqual(resultTableStore.rowItems.length, 6);
        assert.strictEqual((resultTableStore.rowItems[0].group as RowGroup<string, string>).title, 'file_1');
        const nonFile1GroupRowItems = resultTableStore.rowItems.slice(1, resultTableStore.rowItems.length - 1);
        nonFile1GroupRowItems.map((rowItem) => {
            assert.strictEqual((rowItem.group as RowGroup<string, string>).title, 'non file_1');
        });
    });
});
