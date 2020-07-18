// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Result } from 'sarif';

const result1 = {
    message: {
        text: 'Message 1'
    },
    locations: [{
        physicalLocation: {
            artifactLocation: {
                uri: '/folder/file_1.txt',
            }
        }
    }]
} as Result;

const result2 = {
    message: {
        text: 'Message 2'
    },
    locations: [{
        physicalLocation: {
            artifactLocation: {
                uri: '/folder/file_2.txt',
            }
        }
    }]
} as Result;

const result3 = {
    message: {
        text: 'Message 3'
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
} as Result;

export const results = [result1, result2, result3];
