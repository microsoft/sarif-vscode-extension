// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CancellationToken, Uri } from 'vscode';

/**
 * This API is consumed by other extensions. Breaking changes to this API must
 * be reflected in the major version number of the extension.
 */
export interface Api {
    /**
     * Note: If a log has been modified after open was opened, a close and re-open will be required to "refresh" that log.
     * @param logs An array of Uris to open.
     */
    openLogs(logs: Uri[]): Promise<void>;
    closeLogs(logs: Uri[], _options?: unknown, cancellationToken?: CancellationToken): Promise<void>;
    closeAllLogs(): Promise<void>;
    selectByIndex(uri: Uri, runIndex: number, resultIndex: number): Promise<void>;
    uriBases: ReadonlyArray<Uri>;
    dispose(): void;
}
