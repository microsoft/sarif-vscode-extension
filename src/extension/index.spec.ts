// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="../panel/global.d.ts" />
/// Changes to global.d.ts require Mocha restart.
/// Todo: Migrate to tsconfig.files

import assert from 'assert';
import { postSelectLog } from '../panel/indexStore';
import { log } from '../test/mockLog';
import { mockVscode, mockVscodeTestFacing, uriForRealFile } from '../test/mockVscode';
import { URI as Uri } from 'vscode-uri';
import { Api } from './index.d';

// Log object may be modified during testing, thus we need to keep a clean string copy.
const mockLogString = JSON.stringify(log, null, 2);

const proxyquire = require('proxyquire').noCallThru();

let api: Api;

// TODO Tests are hanging on CI.
describe.skip('activate', () => {
    before(async () => {
        const { activate } = proxyquire('.', {
            'fs': {
                readFileSync: () => {
                    return mockLogString;
                }
            },
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
            './telemetry': {
                activate: () => { },
                deactivate: () => { },
            },
        });
        api = await mockVscodeTestFacing.activateExtension(activate);
        await api.openLogs([uriForRealFile]);
        mockVscode.window.createWebviewPanel();
    });

    after(() => {
        api.dispose();
    });

    it('can postSelectArtifact', async () => {
        await mockVscode.commands.executeCommand('sarif.showPanel');
        const { postSelectArtifact } = proxyquire('../panel/indexStore', {
            '../panel/isActive': {
                isActive: () => true,
            },
        });
        mockVscodeTestFacing.showOpenDialogResult = [Uri.file('/file.txt')];
        const result = mockVscodeTestFacing.store!.results[0]!;
        await postSelectArtifact(result, result.locations![0].physicalLocation);
        assert.deepStrictEqual(mockVscodeTestFacing.events.splice(0), [
            'showTextDocument file:///file.txt',
            'selection 0 1 0 2',
        ]);
    });

    it('can postSelectLog', async () => {
        const result = mockVscodeTestFacing.store!.results[0];
        mockVscodeTestFacing.showOpenDialogResult = [uriForRealFile];
        await postSelectLog(result);
        assert.deepStrictEqual(mockVscodeTestFacing.events.splice(0), [
            `showTextDocument ${uriForRealFile.toString()}`,
            'selection 10 15 24 16', // Location in mockLogString.
        ]);
    });
});
