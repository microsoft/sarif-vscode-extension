// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/// <reference path="jsonSourceMap.d.ts" />
import { readFileSync } from 'fs';
import { Log, ReportingDescriptor } from 'sarif';
import { eq, gt, lt } from 'semver';
import { Uri, window, workspace } from 'vscode';
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
    const warnUpgradeExtension = logs.some(log => detectSupport(log, logsSupported, logsNotSupported));
    for (const log of logsNotSupported) {
        if (token?.isCancellationRequested) break;
        const {fsPath} = Uri.parse(log._uri, true);
        window.showWarningMessage(`'${fsPath}' was not loaded. Version '${log.version}' and schema '${log.$schema ?? ''}' is not supported.`);
    }

    // primaryWorkspaceFolderUriString expected to be
    // encoded as `file:///c%3A/folder/`  (toString(false /* encode */))
    // and not as `file:///c:/folder/`    (toString(true /* skip encode */))
    const primaryWorkspaceFolderUriString = workspace.workspaceFolders?.[0]?.uri.toString();
    logsSupported.forEach(log => {
        // Only supporting single workspaces for now.
        augmentLog(log, driverlessRules, primaryWorkspaceFolderUriString);
    });

    if (warnUpgradeExtension) {
        window.showWarningMessage('Some log versions are newer than this extension.');
    }
    return logsSupported;
}

export function normalizeSchema(schema: string): string {
    if (schema === '') return '';
    return new URL(schema).pathname.split('/').pop()
        ?.replace('-schema', '')
        ?.replace(/\.json$/, '')
        ?? '';
}

export function detectSupport(log: Log, logsSupported: Log[], logsNotSupported: Log[]): boolean {
    const {version} = log;
    if (!version || lt(version, '2.1.0')) {
        logsNotSupported.push(log);
    } else if (gt(version, '2.1.0')) {
        return true; // warnUpgradeExtension
    } else if (eq(version, '2.1.0')) {
        const normalizedSchema = normalizeSchema(log.$schema ?? '');
        const supportedSchemas = [
            '',
            'sarif-2.1.0-rtm.6',
            'sarif-2.1.0-rtm.5',
            'sarif-2.1.0', // As of Aug 2020 the contents of `2.1.0` = `2.1.0-rtm.6`. Still true April 2023.
        ];
        if (supportedSchemas.includes(normalizedSchema)) {
            logsSupported.push(log);
        } else {
            logsNotSupported.push(log);
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

    const schema = normalizeSchema(log.$schema ?? '').replace(/^sarif-/, '');
    switch (schema) {
        case '2.1.0-rtm.1':
        case '2.1.0-rtm.2':
        case '2.1.0-rtm.3':
        case '2.1.0-rtm.4':
            applyRtm5(log);
            return true;
        case '2.1.0-rtm.6':
            // No impactful changes between rtm.6 and rtm.5.
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
