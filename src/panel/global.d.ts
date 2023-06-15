// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */ // Type info not available for some external libs.

export {};

declare global {
    // Disagree with Typescript built-in typing `indexOf()`. It does not allow `searchElement` undefined.
    interface Array<T> {
        indexOf(searchElement: T | undefined, fromIndex?: number | undefined): number;
    }
    interface ReadonlyArray<T> {
        indexOf(searchElement: T | undefined, fromIndex?: number | undefined): number;
    }

    interface VsCodeApi {
        /**
         * Post message back to vscode extension.
         */
        postMessage(msg: any): void;
    }

    const vscode: VsCodeApi;

    namespace NodeJS {
        interface Global {
            vscode: any; // VS Code does not provide type info.
            fetch(input: RequestInfo, init?: RequestInit): Promise<Response>; // Only used in mock.
        }
    }
}
