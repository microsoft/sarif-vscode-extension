// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Change } from 'diff';

export function measureDrift(diffBlocks: Change[], offsetStart: number, offsetEnd: number): number | undefined {
    if (diffBlocks[0]?.added || diffBlocks[0]?.removed) {
        diffBlocks.unshift({ value: '' }); // skipping change.count
    }
    let offsetL = 0;
    let offsetR = 0;
    for (let i = 0; i < diffBlocks.length;) {
        if (diffBlocks[i].added || diffBlocks[i].removed) throw new Error('Unexpected added/removed');

        const drift = offsetR - offsetL;
        offsetL += diffBlocks[i].value.length;
        offsetR += diffBlocks[i].value.length;
        i++;
        if (offsetL > offsetStart) { // > or >=
            return offsetL > offsetEnd ? drift : undefined;
        }

        if (diffBlocks[i]?.removed) { // Left side
            offsetL += diffBlocks[i].value.length;
            i++;
        }
        if (diffBlocks[i]?.added) {  // Right side
            offsetR += diffBlocks[i].value.length;
            i++;
        }
        if (offsetL > offsetStart) { // > or >=
            return undefined; // does not map to a changed block
        }
    }
    return undefined;
}
