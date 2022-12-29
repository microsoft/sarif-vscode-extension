// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Region } from 'sarif';

export function renderRegionLocationText(region: Region | undefined) {
    if (!region) { return '-' }

    const { byteOffset, byteLength, startLine, startColumn, charOffset, charLength } = region;
    const startValues = [ startLine, charOffset, byteOffset ];
    const endValues = [ startColumn ?? 1, charLength, byteLength ];
    let start, end;

    for (var i = 0; i < startValues.length; i++) {
        if (startValues[i] !== undefined) {
            start = startValues[i];
            end = endValues[i];
            break;
        }
    }

    if (start)
    {
        return start + (end ? ' : ' + end : '');
    }

    return '-';
}