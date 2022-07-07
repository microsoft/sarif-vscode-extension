// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */ // Allowing any for mocks.

import assert from 'assert';
import { Log } from 'sarif';
import { URI as Uri } from 'vscode-uri';
import '../shared/extension';

const proxyquire = require('proxyquire').noCallThru();

describe('loadLogs', () => {
    const files: Record<string, any> = {
        '/Double.sarif': {
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json',
            version: '2.1.0',
        },
        '/EmbeddedContent.sarif': {
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
            version: '2.1.0',
        },
        '/bad-eval-with-code-flow.sarif': {
            version: '2.1.0',
        },
        '/oldLog.sarif': {
            $schema: 'http://json.schemastore.org/sarif-2.0.0-csd.2.beta.2019-01-24',
            version: '2.0.0-csd.2.beta.2019-01-24',
        },
    };
    const uris = Object.keys(files).map(path => Uri.file(path));
    const stubs = {
        'fs': {
            readFileSync: (fsPath: string) => JSON.stringify(files[Uri.file(fsPath).path]),
        },
        'vscode': {
            Uri,
            window: {
                showWarningMessage: () => { },
            },
            workspace: {
                workspaceFolders: undefined,
            },
        },
        './telemetry': {
            activate: () => { },
            sendLogVersion: () => { },
        },
    };

    it('loads', async () => {
        const { loadLogs } = proxyquire('./loadLogs', stubs);
        const logs = await loadLogs(uris) as Log[];
        assert.strictEqual(logs.every(log => log.version === '2.1.0'), true);
    });

    it('detects supported vs unsupported logs', async () => {
        const logsSupported = [] as Log[];
        const logsNotSupported = [] as Log[];
        const { detectSupport } = proxyquire('./loadLogs', stubs);

        detectSupport({
            version: '2.1.0',
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
        } as any, logsSupported, logsNotSupported);
        assert.strictEqual(logsSupported.length, 1);
        assert.strictEqual(logsNotSupported.length, 0);

        detectSupport({
            version: '2.1.0',
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json',
        } as any, logsSupported, logsNotSupported);
        assert.strictEqual(logsSupported.length, 1);
        assert.strictEqual(logsNotSupported.length, 1);

        detectSupport({
            version: '2.1.0',
        } as any, logsSupported, logsNotSupported);
        assert.strictEqual(logsSupported.length, 2);
        assert.strictEqual(logsNotSupported.length, 1);
    });

    it('honors cancellation', async () => {
        const cancel = { isCancellationRequested: true };
        const { loadLogs } = proxyquire('./loadLogs', stubs);
        const logs = await loadLogs(uris, cancel);
        assert.strictEqual(logs.length, 0);
    });

    it('can quick upgrade if appropriate', async () => {
        const { tryFastUpgradeLog } = proxyquire('./loadLogs', stubs);

        const runs = [{
            results: [{
                suppressions: [{
                    state: 'accepted'
                }],
            }],
        }];

        const rtm5 = {
            version: '2.1.0',
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
            runs,
        } as any;
        assert.strictEqual(await tryFastUpgradeLog(rtm5), false);

        const rtm4 = {
            version: '2.1.0',
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json',
            runs,
        } as any;
        assert.strictEqual(await tryFastUpgradeLog(rtm4), true);
        assert.strictEqual(rtm4.runs[0].results[0].suppressions[0].status, 'accepted');
        assert.strictEqual(rtm4.runs[0].results[0].suppressions[0].state, undefined);
    });

    it('can normalize schema strings', () => {
        const { normalizeSchema } = proxyquire('./loadLogs', stubs);

        // Actual schemas from telemetry, ordered by popularity.
        const schemas = [
            ['https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json'                                                        , 'sarif-2.1.0-rtm.5'],
            ['https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json'                                                        , 'sarif-2.1.0-rtm.4'],
            ['https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json'                                   , 'sarif-2.1.0'],
            ['http://json.schemastore.org/sarif-2.1.0-rtm.1'                                                                                    , 'sarif-2.1.0-rtm.1'],
            ['https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos02/schemas/sarif-schema-2.1.0.json'                                             , 'sarif-2.1.0'],
            ['https://json.schemastore.org/sarif-2.1.0.json'                                                                                    , 'sarif-2.1.0'],
            ['http://json.schemastore.org/sarif-2.1.0-rtm.4'                                                                                    , 'sarif-2.1.0-rtm.4'],
            [''                                                                                                                                 , ''],
            ['http://json.schemastore.org/sarif-1.0.0'                                                                                          , 'sarif-1.0.0'],
            ['http://json.schemastore.org/sarif-2.1.0-rtm.5'                                                                                    , 'sarif-2.1.0-rtm.5'],
            ['https://json.schemastore.org/sarif-2.1.0-rtm.5.json'                                                                              , 'sarif-2.1.0-rtm.5'],
            ['https://schemastore.azurewebsites.net/schemas/json/sarif-1.0.0.json'                                                              , 'sarif-1.0.0'],
            ['http://json.schemastore.org/sarif-2.1.0-rtm.5.json'                                                                               , 'sarif-2.1.0-rtm.5'],
            ['https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Documents/CommitteeSpecifications/2.1.0/sarif-schema-2.1.0.json'    , 'sarif-2.1.0'],
            ['http://json.schemastore.org/sarif-2.1.0'                                                                                          , 'sarif-2.1.0'],
            ['https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos02/schemas/sarif-schema-2.1.0'                                                  , 'sarif-2.1.0'],
            ['http://json-schema.org/draft-04/schema#'                                                                                          , 'schema'],
            ['http://json.schemastore.org/sarif-2.1.0-rtm.0'                                                                                    , 'sarif-2.1.0-rtm.0'],
            ['http://json.schemastore.org/sarif-2.1.0.json'                                                                                     , 'sarif-2.1.0'],
            ['https://www.schemastore.org/schemas/json/sarif-2.1.0-rtm.5.json'                                                                  , 'sarif-2.1.0-rtm.5'],
            ['https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos01/schemas/sarif-schema-2.1.0.json'                                             , 'sarif-2.1.0'],
            ['https://docs.oasis-open.org/sarif/sarif/v2.0/csprd02/schemas/sarif-schema-2.1.0.json'                                             , 'sarif-2.1.0'],
            ['https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json'                                                              , 'sarif-2.1.0'],
            ['http://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json'                                                 , 'sarif-2.1.0'],
            ['https://docs.oasis-open.org/sarif/sarif/v2.1.0/csprd01/schemas/sarif-schema-2.1.0.json'                                           , 'sarif-2.1.0'],
            ['http://json.schemastore.org/sarif-2.0.0'                                                                                          , 'sarif-2.0.0'],
            ['https://raw.githubusercontent.com/schemastore/schemastore/master/src/schemas/json/sarif-2.1.0-rtm.5.json'                         , 'sarif-2.1.0-rtm.5'],
        ];

        assert(schemas.every(([schema, normalized]) => normalizeSchema(schema) === normalized));
    });
});
