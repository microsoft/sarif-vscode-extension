// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/

// The module 'assert' provides assertion methods from node
import * as assert from "assert";
import * as sarif from "sarif";
import { Range } from "vscode";
import { LocationFactory } from "../LocationFactory";

suite("parseRange", () => {
    test("Undefined range", async () => {
        const region = undefined;
        const expected = new Range(0, 0, 0, 1);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, false);
    });

    test("Undefined lines and chars", async () => {
        const region = {} as sarif.Region;
        const expected = new Range(0, 0, 0, 1);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, false);
    });

    test("Basic region", async () => {
        const region = { startLine: 1, startColumn: 2, endLine: 1, endColumn: 4 } as sarif.Region;
        const expected = new Range(0, 1, 0, 3);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, false);
    });

    test("Basic using charLength", async () => {
        const region = { charLength: 2, charOffset: 2} as sarif.Region;
        const expected = new Range(0, 2, 0, 4);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, false);
    });

    test("Different lines", async () => {
        const region = { startLine: 1, startColumn: 2, endLine: 2, endColumn: 1 } as sarif.Region;
        const expected = new Range(0, 1, 1, 0);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, false);
    });

    test("No end values", async () => {
        const region = { startLine: 1, startColumn: 2 } as sarif.Region;
        const expected = new Range(0, 1, 1, 0);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, true);
    });

    test("No end column", async () => {
        const region = { startLine: 1, startColumn: 2, endLine: 1 } as sarif.Region;
        const expected = new Range(0, 1, 1, 0);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, true);
    });

    test("No end line", async () => {
        const region = { startLine: 1, startColumn: 2, endColumn: 4 } as sarif.Region;
        const expected = new Range(0, 1, 0, 3);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, false);
    });

    test("only start line", async () => {
        const region = { startLine: 1 } as sarif.Region;
        const expected = new Range(0, 0, 1, 0);
        // @ts-ignore parseRange is a private static method on LocationFactory
        const result: { range: Range, endOfLine: boolean } = await LocationFactory.parseRange(region);
        assert.deepEqual(result.range, expected);
        assert.equal(result.endOfLine, true);
    });
});
