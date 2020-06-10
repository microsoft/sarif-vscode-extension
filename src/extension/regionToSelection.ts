// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Selection, TextDocument } from 'vscode';
import { _Region } from '../shared';
import '../shared/extension';

export function regionToSelection(doc: TextDocument, region: _Region | undefined) {
	if (!region) return new Selection(0, 0, 0, 0); // TODO: Decide if empty regions should be pre-filtered.

	if (!Array.isArray(region)) {
		const line = doc.lineAt(region);
		return new Selection(
			line.range.start.line,
			line.firstNonWhitespaceCharacterIndex,
			line.range.end.line,
			line.range.end.character,
		);
	}

	if (region.length === 4) {
		return new Selection(...region);
	}

	const [byteOffset, byteLength] = region;
	const startColRaw = byteOffset % 16;
	const endColRaw = (byteOffset + byteLength) % 16;
	return new Selection(
		Math.floor(byteOffset / 16),
		10 + startColRaw + Math.floor(startColRaw / 2),
		Math.floor((byteOffset + byteLength) / 16),
		10 + endColRaw + Math.floor(endColRaw / 2),
	);
}
