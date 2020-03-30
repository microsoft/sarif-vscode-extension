/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * ------------------------------------------------------------------------------------------ */

// Disable TSLint for test code
/* tslint:disable */

import * as vscode from 'vscode';
import { MockMemento } from './mockMemento';

/**
 * Mock @see vscode.ExtensionContext
 */
export class MockExtensionContext<T> implements vscode.ExtensionContext {
    subscriptions: { dispose(): any }[];
    workspaceState: vscode.Memento;
    globalState: vscode.Memento;
    extensionPath: string;
    storagePath: string | undefined;
    logPath: string;
    globalStoragePath: string;

    asAbsolutePath(relativePath: string): string {
        return "";
    }

    constructor() {
        this.subscriptions = [];
        this.workspaceState = new MockMemento<T>();
        this.globalState = new MockMemento<T>();
        this.extensionPath = "B:/path/to/mock/extension";
        this.storagePath = undefined;
        this.globalStoragePath = "B:/path/to/mock/global/storage/path";
        this.logPath = "B:/path/to/mock/logpath";
        this.globalStoragePath = "B:/path/to/mock/globalStoragePath";
    }

    /**
     * Clears the memento storage.
     */
    public clearMementoStorage() {
        this.globalState = new MockMemento<T>();
        this.workspaceState = new MockMemento<T>();
    }
}