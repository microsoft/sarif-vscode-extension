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
		'tag_name': 'v3.2020.430009-insiders',
		'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/26068659/assets'
	},
	{
		'tag_name': 'v3.2020.428010-insiders',
		'assets_url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/25973815/assets'
	},
	{
		'tag_name': 'v3.2020.428006-insiders',
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

// https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/assets/20315654
const assets = [
	{
		'url': 'https://api.github.com/repos/microsoft/sarif-vscode-extension/releases/assets/20315654',
		'name': 'MS-SarifVSCode.sarif-viewer.vsix',
		'label': '',
		'content_type': 'application/octet-stream',
		'state': 'uploaded',
		'size': 112615432,
		'browser_download_url': 'https://github.com/microsoft/sarif-vscode-extension/releases/download/v3.2020.430009-insiders/MS-SarifVSCode.sarif-viewer.vsix'
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
					pipe: () => undefined,
					on: (event: string, listener: any) => listeners[event] = listener
				});
				listeners['end']?.();
			}
		},
	},
	'node-fetch': async (url: string) => {
		if (url.endsWith('releases'))
			return { json: async () => releases };
		if (url.endsWith('assets'))
			return { json: async () => assets };
		return undefined;
	},
	'vscode': {
		commands: {
			executeCommand: fake() // (command: string, ...rest: any[]) => undefined
		},
		extensions: {
			getExtension: () => ({ packageJSON: { version: '3.2020.428010' } })
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
		stubs['vscode'].extensions.getExtension = () => ({ packageJSON: { version: '3.2020.430009-insiders' } });
		const { update } = proxyquire('./update', stubs);
		assert.strictEqual(await update(), false);
	});

	it('does not update, update channel is incorrect', async () => {
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

	// TODO: it('gracefully handles network failure', async () => {})
	// TODO: it('respects proxy settings', async () => {})
});
