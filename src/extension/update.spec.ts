// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */ // Allowing any for mocks.

import assert from 'assert';
import { fake } from 'sinon';

const proxyquire = require('proxyquire').noCallThru();

// https://api.github.com/repos/Microsoft/sarif-vscode-extension/releases
// Releases typically ordered most recent first.
const releases = [
    {
        'tag_name': 'v3.0.1-0',
        'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/26068659/assets',
        'assets': [
            {
                'url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/assets/20315654',
                'name': 'MS-SarifVSCode.sarif-viewer.vsix',
                'label': '',
                'content_type': 'application/vsix',
                'state': 'uploaded',
                'size': 112615432,
                'browser_download_url': 'https://github.com/microsoft/sarif-vscode-extension/releases/download/v3.2020.430009-insiders/MS-SarifVSCode.sarif-viewer.vsix'
            }
        ]
    },
    {
        'tag_name': 'v3.0.0', // installedVersion
        'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/25973815/assets'
    },
    {
        'tag_name': 'v3.0.0-0',
        'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/25964127/assets'
    },
    {
        'tag_name': 'v2.15.0',
        'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/19035869/assets'
    },
    {
        'tag_name': 'v2.0.1',
        'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/11127038/assets'
    },
    {
        'tag_name': 'v2.0.0',
        'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/11125442/assets'
    },
    {
        'tag_name': 'v1.0.0',
        'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/10719743/assets'
    }
];

const makeStubs = () => ({
    'follow-redirects': {
        https: {
            get: (
                _options: Record<string, unknown>,
                callback?: (res: any) => void
            ) => {
                const listeners = {} as Record<string, any>;
                callback?.({
                    statusCode: 200,
                    pipe: () => undefined,
                    on: (event: string, listener: any) => listeners[event] = listener
                });
                listeners['end']?.();
            }
        },
    },
    'node-fetch': async (url: string) => {
        if (url.endsWith('releases'))
            return { status: 200, json: async () => releases };
        return undefined;
    },
    'vscode': {
        commands: {
            executeCommand: fake() // (command: string, ...rest: any[]) => undefined
        },
        extensions: {
            getExtension: () => ({ packageJSON: { version: '3.0.0' } })
        },
        Uri: {
            file: (path: string) => ({ path })
        },
        window: {
            showInformationMessage: async (_msg: string, ...items: string[]) => items[0]
        },
        workspace: {
            getConfiguration: () => ({ get: () => 'Insiders' })
        },
    },
});

describe('update', () => {
    it('updates', async () => {
        const stubs = makeStubs();
        const { update } = proxyquire('./update', stubs);
        assert.strictEqual(await update(), true);
        assert.strictEqual(stubs['vscode'].commands.executeCommand.callCount, 2);
    });

    it('does not update, if already up to date', async () => {
        const stubs = makeStubs();
        stubs['vscode'].extensions.getExtension = () => ({ packageJSON: { version: '3.0.1-0' } });
        const { update } = proxyquire('./update', stubs);
        assert.strictEqual(await update(), false);
    });

    it('does not update, update channel is not "Insiders"', async () => {
        const stubs = makeStubs();
        stubs['follow-redirects'];
        stubs['vscode'].workspace.getConfiguration = () => ({ get: () => 'Default' });
        const { update } = proxyquire('./update', stubs);
        assert.strictEqual(await update(), false);
    });

    it('does not update, if already updating', async () => {
        const { update } = proxyquire('./update', makeStubs());
        void update(); // If this update is in progress (no await), the 2nd should block.
        assert.strictEqual(await update(), false);
    });

    it('does not forget to clear the updateInProgress flag', async () => {
        const { update } = proxyquire('./update', makeStubs());
        await update(); // Wait for the first one to finish, then 2nd should work.
        assert.strictEqual(await update(), true);
    });

    it('gracefully handles network failure', async () => {
        const stubs = makeStubs();
        stubs['node-fetch'] = async () => { throw Error(); };
        const { update } = proxyquire('./update', stubs);
        assert.strictEqual(await update(), false);

        // Make sure updateInProgress isn't stuck on true after failure.
        const { update: updateAgain } = proxyquire('./update', makeStubs());
        assert.strictEqual(await updateAgain(), true);
    });

    it('gracefully handles GitHub rate limit exceeded', async () => {
        const stubs = makeStubs();
        stubs['node-fetch'] = async () => ({
            status: 403,
            statusText: 'rate limit exceeded'
        } as any);
        const { update } = proxyquire('./update', stubs);
        assert.strictEqual(await update(), false);
    });

    it('gracefully handles download forbidden', async () => {
        const stubs = makeStubs();
        stubs['follow-redirects'].https.get = (
            _options: Record<string, unknown>,
            callback?: (res: any) => void
        ) => {
            callback?.({ statusCode: 403 });
        };
        const { update } = proxyquire('./update', stubs);
        assert.strictEqual(await update(), false);
    });

    it('gracefully handles download failure', async () => {
        const stubs = makeStubs();
        stubs['follow-redirects'].https.get = () => ({
            on: (_event: 'error', listener: any) => listener()
        });
        const { update } = proxyquire('./update', stubs);
        assert.strictEqual(await update(), false);
    });

    // TODO: it('respects proxy settings', async () => {})
});
