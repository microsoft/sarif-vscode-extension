// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable filenames/match-regex */
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from 'assert';
import { fake } from 'sinon';

const proxyquire = require('proxyquire').noCallThru();

const resultId = JSON.stringify(['https://api.github.com/repos/owner/repo/code-scanning/analyses/1', 0, 0]);

function makeStubs(response: { status: number, statusText?: string, json: () => Promise<Record<string, unknown>> }) {
    const registeredCommands = {} as Record<string, (context: { resultId: string }) => Promise<void>>;
    const fetch = fake.resolves(response);
    const showErrorMessage = fake.resolves(undefined);
    const showInformationMessage = fake.resolves(undefined);
    let showInputBox = async (): Promise<string | undefined> => 'Dismissal comment';
    const stubs = {
        'node-fetch': fetch,
        'vscode': {
            authentication: {
                getSession: async () => ({ accessToken: 'token' }),
            },
            commands: {
                registerCommand: (name: string, command: (context: { resultId: string }) => Promise<void>) => registeredCommands[name] = command,
            },
            window: {
                showErrorMessage,
                showInformationMessage,
                showInputBox: () => showInputBox(),
            },
        },
    };
    const result = {
        _id: JSON.parse(resultId),
        _log: {
            _uri: 'https://api.github.com/repos/owner/repo/code-scanning/analyses/1',
        },
        properties: {
            'github/alertNumber': 42,
        },
    };
    const store = {
        logs: [{
            _uri: result._log._uri,
            runs: [{
                results: [result],
            }],
        }],
        resultsFixed: [] as string[],
    };
    const outputChannel = {
        appendLine: fake(),
    };
    const { activateGithubCommands } = proxyquire('./index.activateGithubCommands', stubs);
    activateGithubCommands([], store as any, outputChannel as any);

    return {
        dismiss: () => registeredCommands['sarif.alertDismissFalsePositive']({ resultId }),
        fetch,
        outputChannel,
        showErrorMessage,
        showInformationMessage,
        store,
        stubs,
        setShowInputBox: (value: string | undefined) => showInputBox = async () => value,
    };
}

describe('activateGithubCommands', () => {
    it('dismisses alerts and sends delegated dismissal fields', async () => {
        const context = makeStubs({
            status: 200,
            json: async () => ({ state: 'dismissed' }),
        });

        await context.dismiss();

        assert.deepStrictEqual(context.store.resultsFixed, [resultId]);
        const request = context.fetch.firstCall.args[1] as { body: string };
        assert.deepStrictEqual(JSON.parse(request.body), {
            state: 'dismissed',
            dismissed_reason: 'false positive',
            dismissed_comment: 'Dismissal comment',
            create_request: true,
        });
        assert.strictEqual(context.showInformationMessage.firstCall.args[0], 'Code scanning alert 42 dismissed.');
    });

    it('keeps alerts visible when a delegated dismissal request is created', async () => {
        const context = makeStubs({
            status: 200,
            json: async () => ({ state: 'open' }),
        });

        await context.dismiss();

        assert.deepStrictEqual(context.store.resultsFixed, []);
        assert.strictEqual(context.showInformationMessage.firstCall.args[0], 'Dismissal request created for code scanning alert 42.');
    });

    it('keeps alerts visible and surfaces API errors', async () => {
        const context = makeStubs({
            status: 409,
            statusText: 'Conflict',
            json: async () => ({ message: 'An alert dismissal request already exists.' }),
        });

        await context.dismiss();

        assert.deepStrictEqual(context.store.resultsFixed, []);
        assert.strictEqual(
            context.showErrorMessage.firstCall.args[0],
            'Unable to dismiss code scanning alert 42: An alert dismissal request already exists.',
        );
    });

    it('surfaces the status text for non-JSON errors', async () => {
        const context = makeStubs({
            status: 502,
            statusText: 'Bad Gateway',
            json: async () => { throw new Error('Invalid JSON'); },
        });

        await context.dismiss();

        assert.strictEqual(
            context.showErrorMessage.firstCall.args[0],
            'Unable to dismiss code scanning alert 42: Bad Gateway',
        );
    });

    it('does not call GitHub when the comment prompt is cancelled', async () => {
        const context = makeStubs({
            status: 200,
            json: async () => ({ state: 'dismissed' }),
        });
        context.setShowInputBox(undefined);

        await context.dismiss();

        assert.strictEqual(context.fetch.callCount, 0);
    });
});
