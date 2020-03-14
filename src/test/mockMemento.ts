/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * ------------------------------------------------------------------------------------------ */

// Disable TSLint for test code
/* tslint:disable */

import * as vscode from 'vscode';

/**
 * Mock @see vscode.Memento
 */
export class MockMemento<T> implements vscode.Memento {
    /**
     * Map representing global state memento storage.
     */
    private mockGlobalState: Map<string, T> = new Map<string, T>();;

    /**
     * @inheritdoc
     */
    public get(key: string): T | undefined {
        return this.mockGlobalState.get(key);
    }

    /**
    * @inheritdoc
	*/
    public update(key: string, value: any): Thenable<void> {
        this.mockGlobalState.set(key, value);
        return Promise.resolve();
    }
}