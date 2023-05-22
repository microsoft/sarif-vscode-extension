// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Change } from 'diff';
import { Region } from 'sarif';
import { Selection } from 'vscode';
import '../shared/extension';
import { measureDrift } from './measureDrift';
import { TextDocumentLike } from './stringTextDocument';

function regionToSelection(doc: TextDocumentLike, region: Region | undefined) {
    if (!region) return new Selection(0, 0, 0, 0); // TODO: Decide if empty regions should be pre-filtered.

    const { byteOffset, startLine, charOffset } = region;

    if (byteOffset !== undefined) {
        // Assumes Hex editor view.
        const byteLength = region.byteLength ?? 0;
        const startColRaw = byteOffset % 16;
        const endColRaw = (byteOffset + byteLength) % 16;
        return new Selection(
            Math.floor(byteOffset / 16),
            10 + startColRaw + Math.floor(startColRaw / 2),
            Math.floor((byteOffset + byteLength) / 16),
            10 + endColRaw + Math.floor(endColRaw / 2),
        );
    }

    if (startLine !== undefined) {
        const line = doc.lineAt(startLine - 1);

        // Translate from Region (1-based) to Range (0-based).
        const minusOne = (n: number | undefined) => n === undefined ? undefined : n - 1;

        return new Selection(
            startLine - 1,
            Math.max(line.firstNonWhitespaceCharacterIndex, minusOne(region.startColumn) ?? 0), // Trim leading whitespace.
            (region.endLine ?? startLine) - 1,
            minusOne(region.endColumn) ?? line.range.end.character,
        );
    }

    if (charOffset !== undefined) {
        return new Selection(
            doc.positionAt(charOffset),
            doc.positionAt(charOffset + (region.charLength ?? 0))
        );
    }

    return new Selection(0, 0, 0, 0); // Technically an invalid region, but no use complaining to the user.
}

export function driftedRegionToSelection(diffBlocks: Change[], currentDoc: TextDocumentLike, region: Region | undefined, originalDoc?: TextDocumentLike) {
    // If there is no originalDoc, the best we can do is hope no drift has occurred since the scan.
    if (originalDoc === undefined) return regionToSelection(currentDoc, region);

    const originalRange = regionToSelection(originalDoc, region);
    if (originalRange.isReversed) console.warn('REVERSED');

    const drift = measureDrift(
        diffBlocks,
        originalDoc.offsetAt(originalRange.start),
        originalDoc.offsetAt(originalRange.end),
    );
    return drift === undefined
        ? new Selection(
            currentDoc.positionAt(0),
            currentDoc.positionAt(0)
        )
        : new Selection(
            currentDoc.positionAt(originalDoc.offsetAt(originalRange.start) + drift),
            currentDoc.positionAt(originalDoc.offsetAt(originalRange.end)   + drift)
        );
}
