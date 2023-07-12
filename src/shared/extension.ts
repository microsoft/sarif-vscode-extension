// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable no-prototype-builtins */ // Only using prototype on `Array` `Object` which are safe.
/* eslint-disable @typescript-eslint/no-explicit-any */ // Unable to express certain generic extensions.

export {};

// Causing colorization issues if placed above Array.prototype...
// Ideally: ((_) => number) | ((_) => string)
type Selector<T> = (_: T) => number | string

declare global {
    interface Array<T> {
        last: T;
        replace(items: T[]): void; // From Mobx, but not showing up.
        remove(item: T): boolean; // From Mobx, but not showing up.
        removeFirst(predicate: (item: T) => boolean): T | false;
        sortBy<T>(this: T[], selector: Selector<T>, descending?: boolean): Array<T>; // Not a copy
    }
    interface String {
        file: string;
        path: string;
    }
}

!Array.prototype.hasOwnProperty('last') &&
Object.defineProperty(Array.prototype, 'last', {
    get: function() {
        return this[this.length - 1];
    }
});

!Array.prototype.hasOwnProperty('removeFirst') &&
Object.defineProperty(Array.prototype, 'removeFirst', {
    value: function(predicate: (item: any) => boolean) { // Unable to express (item: T) so using (item: any).
        const i = this.findIndex(predicate);
        return i >= 0 && this.splice(i, 1).pop();
    }
});

Array.prototype.sortBy = function<T>(selector: Selector<T>, descending = false) {
    this.sort((a, b) => {
        const aa = selector(a);
        const bb = selector(b);
        const invert = descending ? -1 : 1;
        if (typeof aa === 'string' && typeof bb === 'string') return invert * aa.localeCompare(bb);
        if (typeof aa === 'number' && typeof bb === 'number') return invert * (aa - bb);
        return 0;
    });
    return this;
};

!String.prototype.hasOwnProperty('file') &&
Object.defineProperty(String.prototype, 'file', {
    get: function() {
        return this.substring(this.lastIndexOf('/') + 1, this.length);
    }
});

!String.prototype.hasOwnProperty('path') &&
Object.defineProperty(String.prototype, 'path', {
    get: function() {
        return this.substring(0, this.lastIndexOf('/')).replace(/^\//g, '');
    }
});
