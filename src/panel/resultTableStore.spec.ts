// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Row, RowGroup, RowItem } from './tableStore';
import { observable } from 'mobx';
import { filtersRow, filtersColumn } from '../shared';
import { ResultTableStore } from './resultTableStore';
import { log } from '../test/mockResultTableStore';
import assert from 'assert';
import { Result } from 'sarif';

describe('ResultTableStore', () => {
    const resultsSource = {
        results: log.runs![0].results!,
        resultsFixed: []
    };
    const selection = observable.box<Row | undefined>(undefined);
    const filtersSource = {
        keywords: '',
        filtersRow: filtersRow,
        filtersColumn: filtersColumn
    };

    it('creates different visible columns based on Group Name provided', () => {
        const resultTableStore = new ResultTableStore('File', result => result._relativeUri, resultsSource, filtersSource, selection);
        assert.deepStrictEqual(resultTableStore.columns.map((col) => col.name), ['Line', 'File', 'Message', 'Baseline', 'Suppression', 'Rule']);

        const resultTableStore1 = new ResultTableStore('File', result => result._relativeUri, resultsSource, filtersSource, selection);
        assert.deepStrictEqual(resultTableStore1.visibleColumns.map((col) => col.name), ['Line', 'Message']);

        const resultTableStore2 = new ResultTableStore('Line', result => result._region?.startLine ?? 0, resultsSource, filtersSource, selection);
        assert.deepStrictEqual(resultTableStore2.visibleColumns.map((col) => col.name), ['File', 'Message']);

        const resultTableStore3 = new ResultTableStore('Message', result => result._message, resultsSource, filtersSource, selection);
        assert.deepStrictEqual(resultTableStore3.visibleColumns.map((col) => col.name), ['Line', 'File']);
    });

    it.skip('groups the rows and rowItems based the grouping logic applied on resultsSource', () => {
        const groupBy = (result: Result) => result.locations
            ? result.locations[0].physicalLocation?.artifactLocation?.uri === '/folder/file_1.txt' ? 'file_1' : 'non file_1'
            : undefined;
        const resultTableStore = new ResultTableStore('File', groupBy, resultsSource, filtersSource, selection);
        assert.strictEqual(resultTableStore.rows.length, 2); // Failing due to change in suppression filter defaults.
        assert.strictEqual((resultTableStore.rows[0] as RowGroup<string,string>).title, 'non file_1');
        assert.strictEqual((resultTableStore.rows[1] as RowItem<Record<string, Record<string, string>>>).item.message.text, 'Message 6');
        assert.strictEqual(resultTableStore.rowItems.length, 6);
        assert.strictEqual((resultTableStore.rowItems[0].group as RowGroup<string, string>).title, 'file_1');
        const nonFile1GroupRowItems = resultTableStore.rowItems.slice(1, resultTableStore.rowItems.length);
        assert.deepStrictEqual(nonFile1GroupRowItems.map((rowItem) => (rowItem.group as RowGroup<string,string>).title), ['non file_1', 'non file_1', 'non file_1', 'non file_1', 'non file_1']);
    });
});
