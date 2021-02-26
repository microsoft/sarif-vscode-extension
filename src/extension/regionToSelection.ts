// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Region } from 'sarif';
import { Selection, TextDocument } from 'vscode';
import '../shared/extension';

export function regionToSelection(doc: TextDocument, region: Region | undefined) {
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
        const minusOne = (n: number | undefined) => n === undefined ? undefined : n - 1;
        /**
         * Note according to SARIF format standard, line (number) is 1-based,
         * AND VS Code shows lines as 1-based to the user, but internally VS Code `Range`s are 0-based,
         * So we need to minus one on line numbers of SARIF region before using them to construct VS Code Selection object.
         */
        return new Selection(
            startLine - 1,
            minusOne(region.startColumn) ?? line.firstNonWhitespaceCharacterIndex, // Trimming whitespace for default startColumn value.
            (region.endLine ?? startLine) - 1,
            minusOne(region.endColumn) ?? Number.MAX_SAFE_INTEGER, // Arbitrarily large number representing the rest of the line.
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
