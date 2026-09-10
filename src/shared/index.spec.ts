// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';
import { Log, ReportingDescriptor, Result, Run } from 'sarif';
import { augmentLog, decodeFileUri, effectiveLevel, getDirPath, getFileName, lastOf, removeFirstMatch, sortByInPlace } from '.';
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
        assert.strictEqual(result._uri, '/folder/file.txt');
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
    it(`treats non-'fail' results appropriately`, () => {
        let result = {
            kind: 'informational'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'note');

        result = {
            kind: 'notApplicable'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'note');

        result = {
            kind: 'pass'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'note');

        result = {
            kind: 'open'
        } as Result;

        assert.strictEqual(effectiveLevel(result), 'warning');

        result = {
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

    it (`takes 'level' from 'rule' if necessary`, () => {
        const run = {
            tool: {
                driver: {
                    rules: [
                        {
                            defaultConfiguration: {
                                level: 'error'
                            }
                        }
                    ]
                }
            },
            results: [
                {
                    kind: 'fail'
                    // 'level' not specified.
                },
                {
                    // Neither 'kind' nor 'level' specified.
                }
            ]
        } as Run;

        // Hook up each result to its rule.
        const rule = run.tool.driver.rules![0];
        run.results![0]._rule = rule;
        run.results![1]._rule = rule;

        assert.strictEqual(effectiveLevel(run.results![0]), 'error');
        assert.strictEqual(effectiveLevel(run.results![1]), 'error');
    });
});

describe('decodeFileUri', () => {
    // Skipping while we fix this test for non-Win32 users.
    it.skip(`decodes the 'file' uri schemes`, () => {
        const originalUriString = 'file:///c%3A/Users/muraina/sarif-tutorials/samples/3-Beyond-basics/Results_2.sarif';
        assert.strictEqual(decodeFileUri(originalUriString), 'c:\\Users\\muraina\\sarif-tutorials\\samples\\3-Beyond-basics\\Results_2.sarif');
    });
    it(`gets authority for https uri schemes`, () => {
        assert.strictEqual(decodeFileUri('https://programmers.stackexchange.com/x/y?a=b#123'), 'programmers.stackexchange.com');
    });

    it(`does not affect other uri schemes`, () => {
        assert.strictEqual(decodeFileUri('sarif://programmers.stackexchange.com/x/y?a=b#123'), 'sarif://programmers.stackexchange.com/x/y?a=b#123');
    });
});


describe('String utils', () => {
    describe('file', () => {
        it('returns the file name from a path', () => {
            assert.strictEqual(getFileName('/C:/Users/user.cs'), 'user.cs');
        });
        it('does not fail when there is no file type', () => {
            assert.doesNotThrow(() => getFileName('/C:/Users/user'));
        });
        it('does not fail when there is no hierarchical directory path as part of input', () => {
            assert.doesNotThrow(() => getFileName('user.cs'));
        });
        it('does not fail when input is empty', () => {
            assert.doesNotThrow(() => getFileName(''));
        });
    });
    describe('path', () => {
        it('returns the hierarchical directory from the file path', () => {
            assert.strictEqual(getDirPath('/C:/Users/user.cs'), 'C:/Users');
        });
        it('does not fail when when no hierarchical directory is in the input', () => {
            assert.doesNotThrow(() => getDirPath('user.cs'));
        });
        it('does not fail when input is empty', () => {
            assert.doesNotThrow(() => getDirPath(''));
        });
    });
});

describe('Array utils', () => {
    describe('last', () => {
        it('finds the last element when more than 1 elements are present', () => {
            assert.strictEqual(lastOf(['a', 'b', 'c']), 'c');
        });
        it('returns the only element in the array when there is a single element present', () => {
            assert.strictEqual(lastOf(['a']), 'a');
        });
        it('does not fail if array is empty', () => {
            assert.doesNotThrow(() => lastOf([]));
        });
    });
    describe('removeFirst', () => {
        const logs = [{ _uri: 'uri1' }, { _uri: 'uri2' }, { _uri: 'uri2' }];
        it('removes the first occurrence of matching', () => {
            assert.deepStrictEqual(
                removeFirstMatch(logs, (log) => log._uri === 'uri2'),
                { _uri: 'uri2' }
            );
            assert.deepStrictEqual(
                logs.map((log) => log),
                [{ _uri: 'uri1' }, { _uri: 'uri2' }]
            );
        });
        it('returns false no element match', () => {
            assert.strictEqual(
                removeFirstMatch(logs, (log) => log._uri === 'uri5'),
                false
            );
            assert.deepStrictEqual(
                logs.map((log) => log),
                [{ _uri: 'uri1' }, { _uri: 'uri2' }]
            );
        });
        it('returns false when tries to remove from empty array', () => {
            assert.strictEqual(
                removeFirstMatch([], (log) => log === 'uri5'),
                false
            );
        });
    });
    describe('sortBy', () => {
        it('sorts strings', () => {
            const sortedArrayAsc = sortByInPlace(['c', 'b', 'a', 'd'], (item) => String(item));
            assert.deepStrictEqual(
                sortedArrayAsc.map((i) => i),
                ['a', 'b', 'c', 'd']
            );
            const sortedArrayDesc = sortByInPlace(['c', 'b', 'a', 'd'], (item) => String(item), true);
            assert.deepStrictEqual(
                sortedArrayDesc.map((i) => i),
                ['d', 'c', 'b', 'a']
            );
        });
        it('sorts numbers', () => {
            const sortedArray = sortByInPlace([1, 3, 2, 4], (item) => Number(item));
            assert.deepStrictEqual(
                sortedArray.map((i) => i),
                [1, 2, 3, 4]
            );
            const sortedArrayDesc = sortByInPlace([1, 3, 2, 4], (item) => Number(item), true);
            assert.deepStrictEqual(
                sortedArrayDesc.map((i) => i),
                [4, 3, 2, 1]
            );
        });
        it('sorts in-place', () => {
            const originalArrayStrings = ['c', 'b', 'a', 'd'];
            sortByInPlace(originalArrayStrings, (item) => String(item));
            assert.deepStrictEqual(
                originalArrayStrings.map((i) => i),
                ['a', 'b', 'c', 'd']
            );
            sortByInPlace(originalArrayStrings, (item) => String(item), true);
            assert.deepStrictEqual(
                originalArrayStrings.map((i) => i),
                ['d', 'c', 'b', 'a']
            );
            const originalArrayNumbers = [1, 4, 2, 3];
            sortByInPlace(originalArrayNumbers, (item) => Number(item));
            assert.deepStrictEqual(
                originalArrayNumbers.map((i) => i),
                [1, 2, 3, 4]
            );
            sortByInPlace(originalArrayNumbers, (item) => Number(item), true);
            assert.deepStrictEqual(
                originalArrayNumbers.map((i) => i),
                [4, 3, 2, 1]
            );
        });
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
