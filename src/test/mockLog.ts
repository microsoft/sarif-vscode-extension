// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Log } from 'sarif'

export const log = {
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
					},
					region: {
						startLine: 1,
					},
				}
			}]
		}]
	}]
} as Log
