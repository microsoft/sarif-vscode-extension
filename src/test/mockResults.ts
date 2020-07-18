// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Result } from 'sarif';

const generateMockResult = (message: string, uri: string, level?: string, baselineState?: string, _suppression?: string) : Result => {
    return {
        message: {
            text: message
        },
        level: level,
        baselineState: baselineState,
        _suppression: _suppression,
        locations: [{
            physicalLocation: {
                artifactLocation: {
                    uri: uri,
                }
            }
        }]
    } as Result;
};

export const results = [
    generateMockResult('Message 1', '/folder/file_1.txt'),
    generateMockResult('Message 2', '/folder/file_2.txt'),
    generateMockResult('Message 3', '/folder/file_3.txt', 'none', 'new', 'not suppressed')
];
