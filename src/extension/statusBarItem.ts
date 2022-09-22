// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { observable, observe } from 'mobx';

let statusBarItem: StatusBarItem | undefined;

export const isSpinning = observable.box(false);
function getStatusText() {
    return `$(${isSpinning.get() ? 'sync~spin' : 'shield'  }) Sarif`;
}

export function activateSarifStatusBarItem(disposables: { dispose(): void }[]): void {
    if (statusBarItem) return;

    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    disposables.push(statusBarItem);
    statusBarItem.text = getStatusText();
    statusBarItem.command = 'sarif.showPanel';
    statusBarItem.tooltip ='Show SARIF Panel';
    statusBarItem.show();

    observe(isSpinning, () => statusBarItem!.text = getStatusText());
}
