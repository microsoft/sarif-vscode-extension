// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="jsonSourceMap.d.ts" />
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { Log, ReportingDescriptor } from 'sarif';
import { eq, gt, lt } from 'semver';
import { tmpNameSync } from 'tmp';
import { ProgressLocation, Uri, window } from 'vscode';
import { augmentLog } from '../shared';
import * as Telemetry from './telemetry';

const driverlessRules = new Map<string, ReportingDescriptor>();

export async function loadLogs(uris: Uri[], token?: { isCancellationRequested: boolean }) {
    const logs = uris
        .map(uri => {
            if (token?.isCancellationRequested) return undefined;
            try {
                const file = fs.readFileSync(uri.fsPath, 'utf8')  // Assume scheme file.
                    .replace(/^\uFEFF/, ''); // Trim BOM.
                const log = JSON.parse(file) as Log;
                log._uri = uri.toString();
                return log;
            } catch (error) {
                window.showErrorMessage(`Failed to parse '${uri.fsPath}'`);
                return undefined;
            }
        })
        .filter(log => log) as Log[];

    logs.forEach(log => Telemetry.sendLogVersion(log.version, log.$schema ?? ''));
    logs.forEach(tryFastUpgradeLog);

    const logsNoUpgrade = [] as Log[];
    const logsToUpgrade = [] as Log[];
    const warnUpgradeExtension = logs.some(log => detectUpgrade(log, logsNoUpgrade, logsToUpgrade));
    const upgrades = logsToUpgrade.length;
    if (upgrades) {
        await window.withProgress(
            { location: ProgressLocation.Notification },
            async progress => {
                for (const [i, oldLog] of logsToUpgrade.entries()) {
                    if (token?.isCancellationRequested) break;
                    progress.report({
                        message: `Upgrading ${i + 1} of ${upgrades} log${upgrades === 1 ? '' : 's'}...`,
                        increment: 1 / upgrades * 100
                    });
                    await new Promise(r => setTimeout(r, 0)); // Await otherwise progress does not update. Assumption: await allows the rendering thread to kick in.
                    const {fsPath} = Uri.parse(oldLog._uri, true);
                    try {
                        const tempPath = upgradeLog(fsPath);
                        const file = fs.readFileSync(tempPath, 'utf8'); // Assume scheme file.
                        const log = JSON.parse(file) as Log;
                        log._uri = oldLog._uri;
                        log._uriUpgraded = Uri.file(tempPath).toString();
                        logsNoUpgrade.push(log);
                    } catch (error) {
                        console.error(error);
                        window.showErrorMessage(`Failed to upgrade '${fsPath}'`);
                    }
                }
            }
        );
    }
    logsNoUpgrade.forEach(log => augmentLog(log, driverlessRules));
    if (warnUpgradeExtension) {
        window.showWarningMessage('Some log versions are newer than this extension.');
    }
    return logsNoUpgrade;
}

export function detectUpgrade(log: Log, logsNoUpgrade: Log[], logsToUpgrade: Log[]) {
    const {version} = log;
    if (!version || lt(version, '2.1.0')) {
        logsToUpgrade.push(log);
    } else if (gt(version, '2.1.0')) {
        return true; // warnUpgradeExtension
    } else if (eq(version, '2.1.0')) {
        const schema = log.$schema
            ?.replace('http://json.schemastore.org/sarif-', '')
            ?.replace('https://schemastore.azurewebsites.net/schemas/json/sarif-', '')
            ?.replace(/\.json$/, '');
        if (schema === undefined || schema === '2.1.0-rtm.5'
            || schema === 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0') {
            // https://github.com/microsoft/sarif-vscode-extension/issues/330
            logsNoUpgrade.push(log);
        } else {
            logsToUpgrade.push(log);
        }
    }
    return false;
}

export function upgradeLog(fsPath: string) {
    // Example of a MacOS temp folder: /private/var/folders/9b/hn5353ks051gn79f4b8rn2tm0000gn/T
    const name = tmpNameSync({ postfix: '.sarif' });
    const npx = `npx${process.platform === 'win32' ? '.cmd' : ''}`;
    execFileSync(npx, ['@microsoft/sarif-multitool', 'transform', fsPath, '--force', '--pretty-print', '--output', name]);
    return name;
}

/**
 * Attempts to in-memory upgrade SARIF log. Only some versions (those with simple upgrades) supported.
 * @returns Success of the upgrade.
 */
export function tryFastUpgradeLog(log: Log): boolean {
    const { version } = log;
    if (!eq(version, '2.1.0')) return false;

    const schema = log.$schema
        ?.replace('http://json.schemastore.org/sarif-', '')
        ?.replace('https://schemastore.azurewebsites.net/schemas/json/sarif-', '')
        ?.replace(/\.json$/, '');
    switch (schema) {
    case '2.1.0-rtm.1':
    case '2.1.0-rtm.2':
    case '2.1.0-rtm.3':
    case '2.1.0-rtm.4':
        applyRtm5(log);
        return true;
    default:
        return false;
    }
}

function applyRtm5(log: Log) {
    // Skipping upgrading inlineExternalProperties as the viewer does not use it.
    log.$schema = 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json';
    log.runs?.forEach(run => {
        run.results?.forEach(result => {
            // Pre-rtm5 suppression type is different, thus casting as `any`.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result.suppressions?.forEach((suppression: any) => {
                if (!suppression.state) return;
                suppression.status = suppression.state;
                delete suppression.state;
            });
        });
    });
}
