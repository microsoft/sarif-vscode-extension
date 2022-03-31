// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import assert from 'assert';
import{ SinonFakeTimers, useFakeTimers } from 'sinon';
import { Poller } from './poller';

const proxyquire = require('proxyquire').noCallThru();

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('Timer', () => {
    let clock: SinonFakeTimers | undefined;

    before(() => {
        clock = useFakeTimers();
    });

    after(() => {
        clock?.restore();
    });

    it('Start, tick success', async () => {
        let repeatCount = 0;
        let finalResult: number | undefined;
        let finalTimeout: boolean | undefined;

        const poller = new Poller<number>(
            async () => {
                repeatCount++;
                return 1;
            },
            async (result, timeout) => {
                finalResult = result;
                finalTimeout = timeout;
            },
        );

        poller.start();
        clock?.tick(2000);
        await flushAsync();
        assert.strictEqual(repeatCount, 1);
        assert.strictEqual(finalResult, 1);
        assert.strictEqual(finalTimeout, false);
    });

    it('Start, tick fail', async () => {
        let repeatCount = 0;
        let finalResult: boolean | undefined;
        let finalTimeout: boolean | undefined;

        const poller = new Poller<boolean>(
            async () => {
                repeatCount++;
                return true;
            },
            async (result, timeout) => {
                finalResult = result;
                finalTimeout = timeout;
            },
        );

        poller.start();
        clock?.tick(2000);
        await flushAsync();
        assert.strictEqual(repeatCount, 1);
        assert.strictEqual(finalResult, undefined);
        assert.strictEqual(finalTimeout, false);
    });

    it('Start, tick continue, tick timeout', async () => {
        let repeatCount = 0;
        let finalResult: boolean | undefined;
        let finalTimeout: boolean | undefined;

        const poller = new Poller<boolean>(
            async () => {
                repeatCount++;
                return false;
            },
            async (result, timeout) => {
                finalResult = result;
                finalTimeout = timeout;
            },
        );

        poller.start();

        clock?.tick(2000);
        await flushAsync();
        clock?.tick(2000);
        await flushAsync();

        assert.strictEqual(repeatCount, 1);
        assert.strictEqual(finalResult, undefined);
        assert.strictEqual(finalTimeout, true);
    });

    it('Start, tick continue, tick success', async () => {
        let repeatCount = 0;
        let finalResult: number | undefined;
        let finalTimeout: boolean | undefined;

        const poller = new Poller<number>(
            async () => {
                repeatCount++;
                return repeatCount === 1
                    ? false
                    : 1;
            },
            async (result, timeout) => {
                finalResult = result;
                finalTimeout = timeout;
            },
        );

        poller.start();

        clock?.tick(1000);
        await flushAsync();
        clock?.tick(1000);
        await flushAsync();

        assert.strictEqual(repeatCount, 2);
        assert.strictEqual(finalResult, 1);
        assert.strictEqual(finalTimeout, false);
    });

    it('Start, start again', async () => {
        let repeatCount = 0;
        let finalResult: number | undefined;
        let finalTimeout: boolean | undefined;

        const poller = new Poller<number>(
            async () => {
                repeatCount++;
                return false;
            },
            async (result, timeout) => {
                finalResult = result;
                finalTimeout = timeout;
            },
        );

        poller.start();
        clock?.tick(2000);
        await flushAsync();

        assert.strictEqual(repeatCount, 1);
        assert.strictEqual(finalResult, undefined);
        assert.strictEqual(finalTimeout, undefined);

        poller.start();
        clock?.tick(2000);
        await flushAsync();

        assert.strictEqual(repeatCount, 2);
        assert.strictEqual(finalResult, undefined);
        assert.strictEqual(finalTimeout, undefined);

        clock?.tick(1000);
        await flushAsync();

        assert.strictEqual(repeatCount, 2);
        assert.strictEqual(finalResult, undefined);
        assert.strictEqual(finalTimeout, true);
    });
});
