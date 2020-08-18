// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */ // Allowing any for mocks.

import assert from 'assert';
import { copyFileSync } from 'fs';
import { Log } from 'sarif';
import { URI as Uri } from 'vscode-uri';
import '../shared/extension';

const proxyquire = require('proxyquire').noCallThru();

const vscode = {
    ProgressLocation: { Notification: 15 },
    Uri,
    window: {
        showWarningMessage: () => {},
        withProgress: async (_options: any, task: any) => await task({ report: () => {} }),
        showErrorMessage: async (_message: string) => {}
    }
};

describe('loadLogs', () => {
    const uris = [
        `file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/Double.sarif`,
        `file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/EmbeddedContent.sarif`,
        `file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/bad-eval-with-code-flow.sarif`,
        `file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/oldLog.sarif`,
    ].map(path => Uri.parse(path));

    it('loads', async () => {
        const { loadLogs } = proxyquire('./loadLogs', { vscode });
        const logs = await loadLogs(uris) as Log[];
        assert.strictEqual(logs.every(log => log.version === '2.1.0'), true);
    });

    // Known schemas:
    // sarif-1.0.0.json
    // sarif-2.0.0.json
    // 2.0.0-csd.2.beta.2018-10-10
    // sarif-2.1.0-rtm.2
    // sarif-2.1.0-rtm.3
    // sarif-2.1.0-rtm.4
    // sarif-2.1.0-rtm.5
    it('detects upgrades', async () => {
        const logsNoUpgrade = [] as Log[];
        const logsToUpgrade = [] as Log[];
        const { detectUpgrade } = proxyquire('./loadLogs', { vscode });

        detectUpgrade({
            version: '2.1.0',
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
        } as any, logsNoUpgrade, logsToUpgrade);
        assert.strictEqual(logsNoUpgrade.length, 1);
        assert.strictEqual(logsToUpgrade.length, 0);

        detectUpgrade({
            version: '2.1.0',
            $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json',
        } as any, logsNoUpgrade, logsToUpgrade);
        assert.strictEqual(logsNoUpgrade.length, 1);
        assert.strictEqual(logsToUpgrade.length, 1);

        detectUpgrade({
            version: '2.1.0',
        } as any, logsNoUpgrade, logsToUpgrade);
        assert.strictEqual(logsNoUpgrade.length, 2);
        assert.strictEqual(logsToUpgrade.length, 1);
    });

    it('honors cancellation - first loop', async () => {
        const cancel = { isCancellationRequested: true };
        const { loadLogs } = proxyquire('./loadLogs', { vscode });
        const logs = await loadLogs(uris, cancel);
        assert.strictEqual(logs.length, 0);
    });

    it('honors cancellation - onExecFile', async () => {
        const cancel = { isCancellationRequested: false };
        let logCount = 0;
        const { loadLogs } = proxyquire('./loadLogs', {
            'child_process': {
                execFileSync: (command: string, args?: ReadonlyArray<string>) => {
                    logCount++;
                    cancel.isCancellationRequested = logCount >= 1;
                    copyFileSync(args![2], args![6]); // Simulate upgrade by copying the file.
                }
            },
            vscode
        });
        const logs = await loadLogs(uris, cancel);
        assert.strictEqual(logs.length, 4);
    });

    it('can quick upgrade if appropriate', async () => {
        const { tryFastUpgradeLog } = proxyquire('./loadLogs', { vscode });

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
});
