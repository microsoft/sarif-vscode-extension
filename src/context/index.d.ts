// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode'

export interface Api {
	openLogs(logs: Uri[]): Promise<void>
	closeLogs(logs: Uri[]): Promise<void>
	closeAllLogs(): Promise<void>
	uriBases: ReadonlyArray<Uri>
}
