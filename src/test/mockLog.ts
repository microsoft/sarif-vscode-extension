// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Log } from 'sarif';

const generateMockLog = (version: string, driver: string, message: string, uri: string, startLine: number) : Log => {
    return {
        version: version,
        runs: [{
            tool: {
                driver: { name: driver }
            },
            results: [{
                message: {
                    text: message
                },
                locations: [{
                    physicalLocation: {
                        artifactLocation: {
                            uri: uri,
                        },
                        region: {
                            startLine: startLine,
                        },
                    }
                }]
            }]
        }]
    } as Log;
};

export const log = generateMockLog('2.1.0', 'Driver', 'Message 1', '/folder/file.txt', 1);
export const log2 = generateMockLog('2.1.0', 'Driver', 'Message 2', '/folder/file_2.txt', 18);
export const log3 = generateMockLog('2.1.0', 'Driver', 'Message 3', '/folder/file_3.txt', 28);
