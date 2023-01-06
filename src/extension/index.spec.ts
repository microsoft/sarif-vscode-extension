// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="../panel/global.d.ts" />
/// Changes to global.d.ts require Mocha restart.
/// Todo: Migrate to tsconfig.files

import assert from 'assert';
import { URI as Uri } from 'vscode-uri';
import { postSelectLog } from '../panel/indexStore';
import { log } from '../test/mockLog';
import { mockVscode, mockVscodeTestFacing } from '../test/mockVscode';

// Log object may be modified during testing, thus we need to keep a clean string copy.
const mockLogString = JSON.stringify(log, null, 2);

const proxyquire = require('proxyquire').noCallThru();

describe('activate', () => {
    before(async () => {
        const { activate } = proxyquire('.', {
            'chokidar': {
                '@global': true,
                watch: () => ({ on: () => {} }),
            },
            'fs': {
                '@global': true,
                readFileSync: () => {
                    return mockLogString;
                },
            },
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
            './telemetry': {
                activate: () => { },
            },
        });
        const api = await mockVscodeTestFacing.activateExtension(activate);
        api.openLogs([Uri.parse('file:///.sarif/test.sarif')]);
    });

    it('can postSelectArtifact', async () => {
        const { postSelectArtifact } = proxyquire('../panel/indexStore', {
            '../panel/isActive': {
                isActive: () => true,
            },
        });
        const result = mockVscodeTestFacing.store!.results[0]!;
        await postSelectArtifact(result, result.locations![0].physicalLocation);
        assert.deepStrictEqual(mockVscodeTestFacing.events.splice(0), [
            'showTextDocument file:///folder/file.txt',
            `selection 0 1 0 2`, // 1 = mock firstNonWhitespaceCharacterIndex, 2 = mock line end.
        ]);
    });

    it('can postSelectLog', async () => {
        const result = mockVscodeTestFacing.store!.results[0];
        await postSelectLog(result);
        assert.deepStrictEqual(mockVscodeTestFacing.events.splice(0), [
            'showTextDocument file:///.sarif/test.sarif',
            'selection 9 7 25 8', // Location in mockLogString.
        ]);
    });
});
