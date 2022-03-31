// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// A restartable timer.
export class Timer {
    constructor(readonly timeoutMs: number) {}
    private timeout: NodeJS.Timeout | undefined;

    private _active = false;
    get isActive() {
        return this._active;
    }

    restart() {
        this._active = true;
        this.clear();
        this.timeout = setTimeout(() => this.stop(), this.timeoutMs);
    }

    stop() {
        this._active = false;
        this.clear();
    }

    private clear() {
        if (!this.timeout) return;
        clearTimeout(this.timeout);
        this.timeout = undefined;
    }
}
