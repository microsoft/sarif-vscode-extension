// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert'
import { mockVscode, mockVscodeTestFacing } from '../test/mockVscode'

const proxyquire = require('proxyquire').noCallThru()
const { Baser } = proxyquire('./baser', {
	'vscode': {
		window: {
			showInformationMessage: mockVscode.window.showInformationMessage,
			showOpenDialog: mockVscode.window.showOpenDialog,
		},
		workspace: {
			onDidChangeConfiguration: () => {},
			openTextDocument: mockVscode.workspace.openTextDocument,
			textDocuments: [],
		},
		Uri: mockVscode.Uri
	},
})

describe('baser', () => {
	it('Array.commonLength', () => {
		const commonLength = Array.commonLength(
			['a', 'b', 'c'],
			['a', 'b', 'd']
		)
		assert.strictEqual(commonLength, 2)
	})

	it('Distinct 1', async () => {
		mockVscodeTestFacing.mockFileSystem = ['/projects/project/file1.txt']
		const distinctLocalNames = new Map([
			['file1.txt', '/projects/project/file1.txt']
		])
		const distinctArtifactNames = new Map([
			['file1.txt', 'folder/file1.txt']
		])
		const baser = new Baser(distinctLocalNames, { distinctArtifactNames })
		const localPath = await baser.translateArtifactToLocal('folder/file1.txt')
		mockVscodeTestFacing.mockFileSystem = undefined

		assert.strictEqual(localPath, '/projects/project/file1.txt') // Should also match file1?
	})

	it('Picker 1', async () => {
		const artifact = 'a/b.c'
		mockVscodeTestFacing.mockFileSystem = ['/x/y/a/b.c']
		mockVscodeTestFacing.showOpenDialogResult = mockVscodeTestFacing.mockFileSystem
		const baser = new Baser(new Map(), { distinctArtifactNames: new Map() })
		const localPath = await baser.translateArtifactToLocal(artifact)
		mockVscodeTestFacing.mockFileSystem = undefined
		mockVscodeTestFacing.showOpenDialogResult = []

		assert.strictEqual(localPath, '/x/y/a/b.c')
	})

	it('Picker 2', async () => {
		const artifact = '/a/b.c'
		mockVscodeTestFacing.mockFileSystem = ['/x/y/a/b.c']
		mockVscodeTestFacing.showOpenDialogResult = mockVscodeTestFacing.mockFileSystem
		const baser = new Baser(new Map(), { distinctArtifactNames: new Map() })
		const localPath = await baser.translateArtifactToLocal(artifact)
		mockVscodeTestFacing.mockFileSystem = undefined
		mockVscodeTestFacing.showOpenDialogResult = []

		assert.strictEqual(localPath, '/x/y/a/b.c')
	})

	it('Picker 3', async () => {
		const artifact = '/d/e/f/x/y/a/b.c'
		mockVscodeTestFacing.mockFileSystem = ['/x/y/a/b.c']
		mockVscodeTestFacing.showOpenDialogResult = mockVscodeTestFacing.mockFileSystem
		const baser = new Baser(new Map(), { distinctArtifactNames: new Map() })
		const localRebased = await baser.translateArtifactToLocal(artifact)
		mockVscodeTestFacing.mockFileSystem = undefined
		mockVscodeTestFacing.showOpenDialogResult = []

		assert.strictEqual(localRebased, '/x/y/a/b.c')
	})

	it('commonIndices', async () => {
		const pairs = [...Baser.commonIndices(
			['a', 'b', 'c'],
			['x', 'b', 'y', 'c', 'z', 'b']
		)]
		assert.deepStrictEqual(pairs, [[ 1, 1 ], [ 1, 5 ], [ 2, 3 ]])
	})

	it('API-injected baseUris - None', async () => {
		const artifact = '/a/b/c/d.e'
		mockVscodeTestFacing.mockFileSystem = []
		const baser = new Baser(new Map(), { distinctArtifactNames: new Map() })
		const localRebased = await baser.translateArtifactToLocal(artifact)
		mockVscodeTestFacing.mockFileSystem = undefined

		assert.strictEqual(localRebased, undefined)
	})

	it('API-injected baseUris - Typical', async () => {
		const artifact = 'a/b/c/d.e'
		mockVscodeTestFacing.mockFileSystem = ['x/y/b/c/d.e']
		const baser = new Baser(new Map(), { distinctArtifactNames: new Map() })
		baser.uriBases = ['x/y/b/z']
		const localRebased = await baser.translateArtifactToLocal(artifact)
		mockVscodeTestFacing.mockFileSystem = undefined

		assert.strictEqual(localRebased, 'x/y/b/c/d.e')
	})
})
