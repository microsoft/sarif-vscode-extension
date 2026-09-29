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

describe('activate diagnostics with no results', () => {
    it('does not rebase existing, opened, changed, or observed documents', async () => {
        const document = { fileName: '/workspace/source.ts', uri: Uri.file('/workspace/source.ts') };
        type TestDocument = typeof document;
        const openHandlers: Array<(document: TestDocument) => void> = [];
        const changeHandlers: Array<(event: { document: TestDocument }) => void> = [];
        let resultsObserver: (() => void) | undefined;
        let rebaseCalls = 0;
        let diagnosticClears = 0;
        const diagnostics = { set: () => diagnosticClears++, delete: () => {} };
        const watcher = { add() {}, close() {}, unwatch() {},
            on(_event: string, _handler: () => void) { return watcher; } };
        const workspace = {
            ...mockVscode.workspace,
            textDocuments: [document],
            findFiles: async () => [], // The startup .sarif discovery is outside this regression.
            onDidOpenTextDocument: (handler: (document: TestDocument) => void) => openHandlers.push(handler),
            onDidChangeTextDocument: (handler: (event: { document: TestDocument }) => void) => changeHandlers.push(handler),
        };
        class EmptyStore { static globalState: unknown; readonly logs: unknown[] = [];
            get results() { return []; } }
        const { activate } = proxyquire('.', {
            'vscode': {
                '@global': true,
                ...mockVscode,
                DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
                Disposable: class { dispose() {} },
                languages: { createDiagnosticCollection: () => diagnostics, getDiagnostics: () => [],
                    registerCodeActionsProvider: () => {} },
                window: { ...mockVscode.window, createOutputChannel: () => ({ appendLine: () => {} }),
                    registerUriHandler: () => {} },
                workspace,
            },
            'chokidar': { watch: () => watcher },
            'mobx': { observe: (_store: unknown, property: string, handler: () => void) => {
                if (property === 'results') resultsObserver = handler;
                return () => {};
            } },
            './store': { Store: EmptyStore },
            './uriRebaser': { UriRebaser: class { translateLocalToArtifact() { rebaseCalls++; } } },
            './panel': { Panel: class { show() {} select() {} selectByIndex() {} } },
            './loadLogs': { loadLogs: async () => [] },
            './index.activateDecorations': { activateDecorations: () => {} },
            './index.activateFixes': { activateFixes: () => {} },
            './index.activateGithubAnalyses': { activateGithubAnalyses: () => {} },
            './index.activateGithubCommands': { activateGithubCommands: () => {} },
            './statusBarItem': { activateSarifStatusBarItem: () => {} },
            './telemetry': { activate: () => {}, deactivate: () => {} },
            './update': { update: () => {}, updateChannelConfigSection: '' },
        });

        await mockVscodeTestFacing.activateExtension(activate);
        openHandlers.forEach(handler => handler(document));
        changeHandlers.forEach(handler => handler({ document }));
        resultsObserver!();
        await Promise.resolve();

        assert.strictEqual(rebaseCalls, 0);
        assert.strictEqual(diagnosticClears, 4);
    });
});
