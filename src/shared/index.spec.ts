// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert'
import { Log } from 'sarif'
import { augmentLog } from '.'

describe('augmentLog', () => {
	const log: Log = {
		version: '2.1.0',
		runs: [{
			tool: {
				driver: { name: 'Driver' }
			},
			results: [{
				message: {
					text: 'Message 1'
				},
				locations: [{
					physicalLocation: {
						artifactLocation: {
							uri: '/folder/file.txt',
						}
					}
				}]
			}]
		}]
	}
	const result = log.runs[0].results[0]
	// Helper to visualize: console.log(JSON.stringify(result, null, '    '))

	it('add augmented fields', () => {
		augmentLog(log)
		assert.strictEqual(result._uri, '/folder/file.txt')
		assert.strictEqual(result._line, -1)
		assert.strictEqual(result._message, 'Message 1')
	})

	it('resolves artifactLocation.index', () => {
		log._augmented = false
		result.locations[0].physicalLocation.artifactLocation.index = 0
		log.runs[0].artifacts = [{
			location: {
				uri: '/folder/file.txt'
			},
			contents: {
				text: 'abcdef'
			}
		}]

		augmentLog(log)
		assert.strictEqual(result._uriContents, 'sarif:undefined/0/0/file.txt')
	})
})

/*
Global State Test Notes
- Basic
  - Clear State
  - Change filter
  - Choice:
    - Close tab, reopen tab
	- Close window, reopen tab
  - Verify
    - Checks maintained
	- Order maintained
- Versioning
  - Make sure version isn't lost on roundtrip.
*/