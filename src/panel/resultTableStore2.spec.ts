// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';
import { observable } from 'mobx';
import { Result } from 'sarif';
import { filtersColumn, filtersRow } from '../shared';
import { ResultTableStore } from './resultTableStore';
import { Row } from './tableStore';

describe('ResultTableStore', () => {
    console.log('describe');
    function createResult(message: string, uri: string, level: string): Result {
        return {
            locations: [{
                physicalLocation: {
                    artifactLocation: { uri }
                }
            }],
            _message: message, // Computed from .message.text.
            level,
            baselineState: 'new',
            _suppression: 'not suppressed',
        } as Result;
    }

    const filtersSource = { keywords: '', filtersRow, filtersColumn };
    const store = new ResultTableStore(
        'File',
        result => result._relativeUri,
        {
            results: [
                createResult('Message One', 'file1.txt', 'error'),
                createResult('Message Two', 'file1.txt', 'warning'),
            ]
        },
        filtersSource,
        observable.box<Row | undefined>(undefined),
    );

    it('hides the column of the current group', () => {
        assert.ok(store.visibleColumns.every(col => col.name !== 'File'));
    });

    it('responds to column filter settings', () => {
        assert.deepStrictEqual(store.visibleColumns.map(col => col.name), ['Line', 'Message']);
        filtersSource.filtersColumn.Columns['Baseline'] = 'visible'; // Show another column.
        assert.deepStrictEqual(store.visibleColumns.map(col => col.name), ['Line', 'Message', 'Baseline']);
        filtersSource.filtersColumn.Columns['Baseline'] = undefined; // Hide that column again.
        assert.deepStrictEqual(store.visibleColumns.map(col => col.name), ['Line', 'Message']);
    });

    it('filters by keywords', () => {
        assert.strictEqual(store.rows.length, 3); // Group, Item, Item
        filtersSource.keywords = 'two'; // Testing case insensitivity.
        assert.strictEqual(store.rows.length, 2); // Group, Item
        filtersSource.keywords = '';
        assert.strictEqual(store.rows.length, 3); // Group, Item, Item
    });

    // "level" is representative of "baselineState" and "suppression" in terms of logic.
    it('filters by level', () => {
        assert.strictEqual(store.rows.length, 3); // Group, Item, Item
        filtersSource.filtersRow.Level['Warning'] = undefined; // Hide warnings.
        assert.strictEqual(store.rows.length, 2); // Group, Item
        filtersSource.filtersRow.Level['Warning'] = 'visible'; // Show warnings.
        assert.strictEqual(store.rows.length, 3); // Group, Item, Item
    });
});
