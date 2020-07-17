// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Log } from 'sarif';

export const log = {
    version: '2.1.0',
    runs: [{
        tool: {
            driver: { name: 'Driver' }
        },
        results: [{
            message: {
                text: 'ResultIndexStore1'
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_1.txt',
                    }
                }
            }]
        },{
            message: {
                text: 'ResultIndexStore2'
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_2.txt',
                    }
                }
            }]
        }, {
            message: {
                text: 'ResultIndexStore3'
            },
            level: 'none',
            baselineState: 'new',
            _suppression: 'not suppressed',
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_3.txt',
                    }
                }
            }]
        }]
    }]
} as Log;
