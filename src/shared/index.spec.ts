// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';
import { Log, ReportingDescriptor, Result } from 'sarif';
import { augmentLog, decodeFileUri, effectiveLevel } from '.';
import './extension';

describe('augmentLog', () => {
    const log = {
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
    } as Log;
    const result = log.runs![0].results![0];
    // Helper to visualize: console.log(JSON.stringify(result, null, '    '))

    it('add augmented fields', () => {
        augmentLog(log);
        assert.strictEqual(result._uri, 'file:///folder/file.txt');
        assert.strictEqual(result._line, 0);
        assert.strictEqual(result._message, 'Message 1');
    });

    it('resolves artifactLocation.index', () => {
        log._augmented = false;
        result.locations![0].physicalLocation!.artifactLocation!.index = 0;
        log.runs[0].artifacts = [{
            location: {
                uri: '/folder/file.txt'
            },
            contents: {
                text: 'abcdef'
            }
        }];

        augmentLog(log);
        assert.strictEqual(result._uriContents, 'sarif:undefined/0/0/file.txt');
    });

    it('is able to reuse driverless rule instances across runs', () => {
        const placeholderTool = {
            driver: { name: 'Driver' }
        };
        const placeholderMessage = {
            text: 'Message 1'
        };
        const run0result = {
            message: placeholderMessage,
            ruleId: 'TEST001',
        } as Result;
        const run1result = {
            message: placeholderMessage,
            ruleId: 'TEST001',
        } as Result;
        const log = {
            runs: [
                {
                    tool: placeholderTool,
                    results: [run0result]
                },
                {
                    tool: placeholderTool,
                    results: [run1result]
                }
            ]
        } as Log;

        augmentLog(log, new Map<string, ReportingDescriptor>());
        assert.strictEqual(run0result._rule, run1result._rule);
    });
});

describe('effectiveLevel', () => {
    it(`treats 'informational' as 'note'`, () => {
        const result = {
            kind: 'informational'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'note');
    });

    it(`treats 'notApplicable' as 'note'`, () => {
        const result = {
            kind: 'notApplicable'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'note');
    });

    it(`treats 'pass' as 'note'`, () => {
        const result = {
            kind: 'pass'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'note');
    });

    it(`treats 'open' as 'warning'`, () => {
        const result = {
            kind: 'open'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'warning');
    });

    it(`treats 'review' as 'warning'`, () => {
        const result = {
            kind: 'review'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'warning');
    });

    it (`treats 'fail' according to 'level'`, () => {
        const result = {
            kind: 'fail',
            level: 'error'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'error');
    });
});

describe('decodeFileUri', () => {
    // Skipping while we fix this test for non-Win32 users.
    it.skip(`decodes the 'file' uri schemes`, () => {
        const originalUriString = 'file:///c%3A/Users/muraina/sarif-tutorials/samples/3-Beyond-basics/Results_2.sarif';
        assert.strictEqual(decodeFileUri(originalUriString), 'c:\\Users\\muraina\\sarif-tutorials\\samples\\3-Beyond-basics\\Results_2.sarif');
    });
    it(`does not affect 'non-file' uri schemes`, () => {
        assert.strictEqual(decodeFileUri('https://programmers.stackexchange.com'), 'https://programmers.stackexchange.com');
    });
});

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
