// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.


export {};

declare global {
    interface Array<T> {
        replace(items: T[]): void; // From Mobx, but not showing up.
        remove(item: T): boolean; // From Mobx, but not showing up.
    }
}