// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import assert from 'assert';
import{ SinonFakeTimers, useFakeTimers } from 'sinon';
import { Timer } from './timer';

describe('Timer', () => {
    const timer = new Timer(2000);
    let clock: SinonFakeTimers | undefined;

    before(() => {
        clock = useFakeTimers();
    });

    after(() => {
        clock?.restore();
    });

    it('Defaults to not isActive', () => {
        assert(!timer.isActive);
    });

    it('Stops by itself.', () => {
        timer.restart();
        assert(timer.isActive);

        clock?.tick(1000);
        assert(timer.isActive);

        clock?.tick(1000);
        assert(!timer.isActive);
    });

    it('Restart prolongs the time.', () => {
        timer.restart();
        assert(timer.isActive);

        clock?.tick(1000);
        assert(timer.isActive);

        timer.restart();
        assert(timer.isActive);

        clock?.tick(1000);
        assert(timer.isActive);

        clock?.tick(1000);
        assert(!timer.isActive);
    });

    it('Manual stop before time runs out.', () => {
        timer.restart();
        assert(timer.isActive);

        clock?.tick(1000);
        assert(timer.isActive);

        timer.stop();
        assert(!timer.isActive);
    });
});
