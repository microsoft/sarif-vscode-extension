/// <reference path="../panel/global.d.ts" />
/// Changes to global.d.ts require Mocha restart.
/// Todo: Migrate to tsconfig.files

import assert from 'assert'
import { mockVscode } from '../test/mockVscode'
import { activate } from '.'
import { postSelectArtifact, postSelectLog } from '../panel/IndexStore'
import { log } from '../test/mockLog'

describe('activate', () => {
	before(async () => {
		mockVscode.mockReadFile = JSON.stringify(log)
		await mockVscode.activateExtension(activate)
	})

	it('can postSelectArtifact', async () => {
		const result = mockVscode.store.results[0]
		await postSelectArtifact(result, result.locations[0].physicalLocation)
		assert.deepEqual(mockVscode.events.splice(0), [
			'showTextDocument file:///folder/file.txt',
			'selection 0 1 0 2',
		])
	})

	it('can postSelectLog', async () => {
		const result = mockVscode.store.results[0]
		await postSelectLog(result)
		assert.deepEqual(mockVscode.events.splice(0), [
			'showTextDocument file:///.sarif/test.sarif',
			'selection 0 75 0 215',
		])
	})

	after(() => {
		mockVscode.mockReadFile = undefined
	})
})
