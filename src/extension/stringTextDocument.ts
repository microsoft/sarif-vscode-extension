// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Position } from 'vscode';

function getOffset(text: string, position: Position): number {
    let line = 0;
    for (let i = 0; i < text.length; i++) {
        if (line === position.line) {
            return i + position.character;
        }

        const ch = text[i];
        if (ch === '\n') line++;
    }
    return text.length; // Right design?
}

interface TextLineLike {
    firstNonWhitespaceCharacterIndex: number;
    range: { end: { character: number } };
}

export interface TextDocumentLike {
    lineAt(line: number): TextLineLike;
    positionAt(offset: number): Position;
    offsetAt(position: Position): number;
}

// A TextDocument-like object backed by a string rather than a file on disk.
export class StringTextDocument implements TextDocumentLike {
    constructor(readonly text: string) {}

    getText() {
        return this.text;
    }

    private _lines: undefined | string[];
    private get lines(): string[] {
        if (!this._lines) {
            this._lines = this.text.split(/\r?\n/g);
        }
        return this._lines;
    }

    lineAt(line: number): TextLineLike {
        const lineText = this.lines[line];
        return {
            firstNonWhitespaceCharacterIndex: lineText.search(/\S|$/),
            range: { end: { character: lineText.length } },
        };
    }

    positionAt(_offset: number): Position {
        // Reserved for charOffset+charLength which we currently do not support.
        return new Position(0, 0);
    }

    offsetAt(position: Position) {
        return getOffset(this.text, position);
    }
}
