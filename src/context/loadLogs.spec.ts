// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert'
import mock from 'mock-require'

const progress = {
	report: data => {
		console.warn(data)
	}
}
class Uri {
	static parse(value) { return new Uri(value) }
	static file(path) { return Uri.parse(`file://${path}`) }

	constructor(readonly value) {}
	get path() { return this.value.replace('file://', '') }
	get fsPath() { return this.path } // Assume Unix.
	toString() { return this.value }
	scheme; authority; query; fragment; with; toJSON // Stubs
}
mock('vscode', {
	ProgressLocation: { Notification: 15 },
	Uri,
	window: {
		showWarningMessage: () => {},
		withProgress: async (_options, task) => await task(progress),
		showErrorMessage: async (message) => {}
	}
})

import { loadLogs, detectUpgrade } from './loadLogs'
import { Log } from 'sarif'

describe('loadLogs', () => {
	it('loads', async () => {
		const uris = [
			`file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/Double.sarif`,
			`file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/EmbeddedContent.sarif`,
			`file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/bad-eval-with-code-flow.sarif`,
			`file:///Users/jeff/projects/sarif-vscode/samplesDemo/.sarif/oldLog.sarif`,
		].map(path => Uri.parse(path))
		const logs = await loadLogs(uris)
		assert.strictEqual(logs.every(log => log.version === '2.1.0'), true)
	})

	// Known schemas:
	// sarif-1.0.0.json
	// sarif-2.0.0.json
	// 2.0.0-csd.2.beta.2018-10-10
	// sarif-2.1.0-rtm.2
	// sarif-2.1.0-rtm.3
	// sarif-2.1.0-rtm.4
	// sarif-2.1.0-rtm.5
	it('detects upgrades', async () => {
		const logsNoUpgrade = [] as Log[]
		const logsToUpgrade = [] as Log[]

		detectUpgrade({
			version: '2.1.0',
			$schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
		} as any, logsNoUpgrade, logsToUpgrade)
		assert.strictEqual(logsNoUpgrade.length, 1)
		assert.strictEqual(logsToUpgrade.length, 0)

		detectUpgrade({
			version: '2.1.0',
			$schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json',
		} as any, logsNoUpgrade, logsToUpgrade)
		assert.strictEqual(logsNoUpgrade.length, 1)
		assert.strictEqual(logsToUpgrade.length, 1)

		detectUpgrade({
			version: '2.1.0',
		} as any, logsNoUpgrade, logsToUpgrade)
		assert.strictEqual(logsNoUpgrade.length, 2)
		assert.strictEqual(logsToUpgrade.length, 1)
	})
})
