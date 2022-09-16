// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Log } from 'sarif';

export function overrideBaseUri(log: Log, newBaseUri: string | undefined): void {
    if (!newBaseUri) return;
    for (const run of log.runs ?? []) {
        const originalUriBaseIds = run.originalUriBaseIds ?? {};
        for (const id of Object.keys(originalUriBaseIds)) {
            originalUriBaseIds[id].uri = newBaseUri;
        }
    }
}
