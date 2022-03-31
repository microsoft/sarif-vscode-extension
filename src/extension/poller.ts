// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Timer } from './timer';

// Even if timeoutMs=0, start() will call repeatAction() once.
// Then after the tickTimeoutMs, finalAction().
// TODO: should tickTimeoutMs always be less than timeoutMs?
export class Poller<T> {
    private tickRunning = false;
    private tickTimeoutMs = 1000; // The "sampling rate".
    private tickTimeout: NodeJS.Timeout | undefined;
    private timer = new Timer(this.timeoutMs);

    // if `action` returns:
    // false | undefined - continue trying.
    // json              - success, stop, call action.
    // undefined         - failure, stop, call final.
    constructor(
        readonly repeatAction: () => Promise<boolean | T>,
        readonly finalAction: (result: T | undefined, timeout?: boolean) => Promise<void>,
        readonly timeoutMs = 2001,
    ) {}

    get isPolling() { // Testing crutch.
        return !!this.tickTimeout;
    }

    start() {
        this.timer.restart();
        this.tick();
    }

    // Explicit stop() does not invoke final().
    stop() {
        this.clearShortTimeout();
    }

    private async tick() {
        if (this.tickRunning) return;

        this.clearShortTimeout(); // In case the shortTimeout was already running.

        if (!this.timer.isActive) {
            this.finalAction(undefined, true);
            return;
        }

        this.tickRunning = true;
        {
            const result = await this.repeatAction();
            if (result === true) {
                this.finalAction(undefined, false); // Fail.
            } else if (result === false) { // Continue.
                this.tickTimeout = setTimeout(() => this.tick(), this.tickTimeoutMs);
            } else { // Ideally can check if result is T.
                this.finalAction(result, false); // Success.
            }
        }
        this.tickRunning = false;
    }

    private clearShortTimeout() {
        if (this.tickTimeout) {
            clearTimeout(this.tickTimeout);
            this.tickTimeout = undefined;
        }
    }
}
