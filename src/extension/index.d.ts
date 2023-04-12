// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';

export interface Api {
    /**
     * Note: If a log has been modified after open was opened, a close and re-open will be required to "refresh" that log.
     * @param logs An array of Uris to open.
     */
    openLogs(logs: Uri[]): Promise<void>;
    closeLogs(logs: Uri[]): Promise<void>;
    closeAllLogs(): Promise<void>;
    selectByIndex(uri: Uri, runIndex: number, resultIndex: number): Promise<void>;
    uriBases: ReadonlyArray<Uri>;
}
