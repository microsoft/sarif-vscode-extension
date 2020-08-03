
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';

describe('Extension', () => {
    describe('Array.commonLength', () => {
        it('finds the length of common consecutive elements when common elements start from index 0', () => {
            assert.strictEqual(Array.commonLength(['a', 'b', 'c'], ['a', 'b', 'd', 'e']), 2);
        });
        it('returns zero if common consecutive elements do not start from 0 index', () => {
            assert.strictEqual(Array.commonLength(['a', 'b', 'c'], ['b', 'c', 'd']), 0);
        });
        it('returns zero if no common consecutive elements', () => {
            assert.strictEqual(Array.commonLength(['a', 'b', 'c'], ['x', 'y', 'z']), 0);
        });
        it('returns zero if one array is empty', () => {
            assert.strictEqual(Array.commonLength(['a', 'b', 'c'], []), 0);
            assert.strictEqual(Array.commonLength([], ['a', 'b']), 0);
        });
    });
    describe('Array.prototype.last', () => {
        it('finds the last element when more than 1 elements are present', () => {
            assert.strictEqual(['a', 'b', 'c'].last, 'c');
        });
        it('returns the only element in the array when there is a single element present', () => {
            assert.strictEqual(['a'].last, 'a');
        });
        it('does not fail if array is empty', () => {
            assert.doesNotThrow(() => [].last);
        });
    });
    describe('Array.prototype.removeFirst', () => {
        const logs = [
            { '_uri': 'uri1' },
            { '_uri': 'uri2' },
            { '_uri': 'uri2' },
            { '_uri': 'uri3' },
            { '_uri': 'uri4' }
        ];
        it('removes the first occurrence of matching', () => {
            assert.deepStrictEqual(logs.removeFirst(log => log._uri === 'uri2'), {'_uri': 'uri2'});
            assert.deepStrictEqual(logs.map(log => log),[
                {'_uri': 'uri1'},
                {'_uri': 'uri2'},
                {'_uri': 'uri3'},
                {'_uri': 'uri4'}
            ]);
        });
        it('returns false no element match', () => {
            assert.strictEqual(logs.removeFirst(log => log._uri === 'uri5'), false);
            assert.deepStrictEqual(logs.map(log => log), [
                {'_uri': 'uri1'},
                {'_uri': 'uri2'},
                {'_uri': 'uri3'},
                {'_uri': 'uri4'}
            ]);
        });
        it('returns false when tries to remove from empty array', () => {
            assert.strictEqual([].removeFirst(log => log === 'uri5'), false);
        });
    });
    describe('String.prototype.sortBy', () => {
        it('sorts strings', () => {
            const sortedArrayAsc = ['c','f', 'a', 'd', 'b', 'e'].sortBy(item => String(item));
            assert.deepStrictEqual(sortedArrayAsc.map(i => i), ['a', 'b', 'c', 'd', 'e', 'f']);
            const sortedArrayDesc = ['c','f', 'a', 'd', 'b', 'e'].sortBy(item => String(item), true);
            assert.deepStrictEqual(sortedArrayDesc.map(i => i), ['f', 'e', 'd', 'c', 'b', 'a']);
        });
        it('sorts numbers', () => {
            const sortedArray = [1,4,5,2,3,6].sortBy(item => Number(item));
            assert.deepStrictEqual(sortedArray.map(i => i), [1,2,3,4,5,6]);
            const sortedArrayDesc = [1,4,5,2,3,6].sortBy(item => Number(item), true);
            assert.deepStrictEqual(sortedArrayDesc.map(i => i), [6,5,4,3,2,1]);
        });
        it('sorts in-place', () => {
            const originalArrayStrings = ['c','f', 'a', 'd', 'b', 'e'];
            originalArrayStrings.sortBy(item => String(item));
            assert.deepStrictEqual(originalArrayStrings.map(i => i), ['a', 'b', 'c', 'd', 'e', 'f']);
            originalArrayStrings.sortBy(item => String(item), true);
            assert.deepStrictEqual(originalArrayStrings.map(i => i), ['f', 'e', 'd', 'c', 'b', 'a']);
            const originalArrayNumbers = [1,4,5,2,3,6];
            originalArrayNumbers.sortBy(item => Number(item));
            assert.deepStrictEqual(originalArrayNumbers.map(i => i), [1,2,3,4,5,6]);
            originalArrayNumbers.sortBy(item => Number(item), true);
            assert.deepStrictEqual(originalArrayNumbers.map(i => i), [6,5,4,3,2,1]);
        });
    });
    describe('String.prototype.file', () => {
        it('returns the file name from an absolute path', () => {
            assert.strictEqual('/C:/Users/muraina/sarif-vscode-extension/samples/user.cs'.file, 'user.cs');
        });
        it('returns the file name from a relative path', () => {
            assert.strictEqual('muraina/sarif-vscode-extension/samples/user.cs'.file, 'user.cs');
        });
        it('does not fail when there is no file type', () => {
            assert.doesNotThrow(() => '/C:/Users/muraina/sarif-vscode-extension/samples/user'.file);
            assert.doesNotThrow(() => 'muraina/sarif-vscode-extension/samples/user'.file);
        });
        it('does not fail when there is no hierarchical directory path as part of input', () => {
            assert.doesNotThrow(() => 'user.cs'.file);
        });
        it('does not fail when input is empty', () => {
            assert.doesNotThrow(() => ''.file);
        });
    });
    describe('String.prototype.path', () => {
        it('returns the hierarchical directory from the file path', () => {
            assert.strictEqual('/C:/Users/muraina/sarif-vscode-extension/samples/user.cs'.path, 'C:/Users/muraina/sarif-vscode-extension/samples');
        });
        it('does not fail when when no hierarchical directory is in the input', () => {
            assert.doesNotThrow(() => 'user.cs'.path);
        });
        it('does not fail when input is empty', () => {
            assert.doesNotThrow(() => ''.path);
        });
    });
});
