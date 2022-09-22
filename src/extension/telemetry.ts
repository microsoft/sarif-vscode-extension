// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import TelemetryReporter from 'vscode-extension-telemetry';
import { publisher, name, version } from '../../package.json';

let reporter: TelemetryReporter;

export function activate() {
    const key = 'bf8e52c4-6749-4709-92a0-e3a8fd589648';
    reporter = new TelemetryReporter(`${publisher}.${name}`, version, key);
}

export function deactivate() {
    reporter?.dispose();
}

export function sendLogVersion(version: string, $schema: string) {
    reporter?.sendTelemetryEvent('logVersion', { version, $schema });
}

export function sendGithubEligibility(eligibility: string) {
    reporter?.sendTelemetryEvent('githubEligibility', { eligibility });
}

export function sendGithubIntroductionChoice(choice: string | undefined) {
    reporter?.sendTelemetryEvent('githubIntroductionChoice', { choice: choice ?? 'undefined' });
}

export function sendGithubConfig(value: string) {
    reporter?.sendTelemetryEvent('githubConfig', { value });
}
