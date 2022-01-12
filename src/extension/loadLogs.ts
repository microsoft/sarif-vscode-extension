// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="jsonSourceMap.d.ts" />
import { readFileSync } from 'fs';
import { Log, ReportingDescriptor } from 'sarif';
import { eq, gt, lt } from 'semver';
import { Uri, window } from 'vscode';
import { augmentLog } from '../shared';
import * as Telemetry from './telemetry';

export const driverlessRules = new Map<string, ReportingDescriptor>();

export async function loadLogs(uris: Uri[], token?: { isCancellationRequested: boolean }) {
    const logs = uris
        .map(uri => {
            if (token?.isCancellationRequested) return undefined;
            try {
                const file = readFileSync(uri.fsPath, 'utf8')  // Assume scheme file.
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

    const logsSupported = [] as Log[];
    const logsNotSupported = [] as Log[];
    const warnUpgradeExtension = logs.some(log => detectUpgrade(log, logsSupported, logsNotSupported));
    for (const log of logsNotSupported) {
        if (token?.isCancellationRequested) break;
        const {fsPath} = Uri.parse(log._uri, true);
        window.showWarningMessage(`'${fsPath}' was not loaded. Version '${log.version}' and schema '${log.$schema ?? ''}' is not supported.`);
    }
    logsSupported.forEach(log => augmentLog(log, driverlessRules));
    if (warnUpgradeExtension) {
        window.showWarningMessage('Some log versions are newer than this extension.');
    }
    return logsSupported;
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
            || schema === 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0'
            || schema === 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos02/schemas/sarif-schema-2.1.0') {
            // https://github.com/microsoft/sarif-vscode-extension/issues/330
            logsNoUpgrade.push(log);
        } else {
            logsToUpgrade.push(log);
        }
    }
    return false;
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
