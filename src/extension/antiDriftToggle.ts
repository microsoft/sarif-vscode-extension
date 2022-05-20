// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { commands, StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { observable } from 'mobx';

const antiDriftCommandName = 'sarif.toggleDrift';
export const antiDriftEnabled = observable.box(true);

let statusBarItem: StatusBarItem | undefined;

function getStatusText() {
    return `$(beaker) Anti-Drift: ${antiDriftEnabled.get() ? 'On' : 'Off'}`;
}

export function activateAntiDriftStatusBarItem(disposables: { dispose(): void }[]): void {
    if (statusBarItem) return;

    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    disposables.push(statusBarItem);
    statusBarItem.text = getStatusText();
    statusBarItem.command = antiDriftCommandName;
    statusBarItem.show();

    disposables.push(commands.registerCommand(antiDriftCommandName, () => {
        antiDriftEnabled.set(!antiDriftEnabled.get());
        statusBarItem!.text = getStatusText();
    }));
}
