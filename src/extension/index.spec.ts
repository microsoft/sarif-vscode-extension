// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="../panel/global.d.ts" />
/// Changes to global.d.ts require Mocha restart.
/// Todo: Migrate to tsconfig.files

import assert from 'assert';
import { postSelectArtifact, postSelectLog } from '../panel/indexStore';
import { log } from '../test/mockLog';
import { mockVscode, mockVscodeTestFacing } from '../test/mockVscode';

const proxyquire = require('proxyquire').noCallThru();

describe('activate', () => {
    before(async () => {
        const { activate } = proxyquire('.', {
            'fs': {
                '@global': true,
                readFileSync: () => {
                    return JSON.stringify(log);
                }
            },
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
        });
        const api = await mockVscodeTestFacing.activateExtension(activate);
        api.openLogs([new mockVscode.Uri('/.sarif/test.sarif')]);
    });

    it('can postSelectArtifact', async () => {
        const result = mockVscodeTestFacing.store!.results[0]!;
        await postSelectArtifact(result, result.locations![0].physicalLocation);
        assert.deepEqual(mockVscodeTestFacing.events.splice(0), [
            'showTextDocument file:///folder/file.txt',
            'selection 0 0 0 0',
        ]);
    });

    it('can postSelectLog', async () => {
        const result = mockVscodeTestFacing.store!.results[0];
        await postSelectLog(result);
        assert.deepEqual(mockVscodeTestFacing.events.splice(0), [
            'showTextDocument file:///.sarif/test.sarif',
            'selection 0 75 0 215',
        ]);
    });
});
