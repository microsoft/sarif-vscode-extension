/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
import * as vscode from 'vscode';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class BinaryContentRenderer {
    private static binaryDataMarkdownHeader: string = localize("embeddedContent.tableHeader", "|Offset|0|1|2|3|4|5|6|7|\r\n|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|");
    private static bytesPerRow: number = 8;
    private static headerRows: number = 4;
    private static markdownCellHeaderColumnOffset: number = 1;
    private static contentLengthPerTableCell: number = 4;

    private readonly contentBuffer: Buffer;
    public constructor(content: string) {
        this.contentBuffer = Buffer.from(content, 'base64');
    }

    public renderAsMarkdown(displayFileName: string): string {
        let markDownContent: string = localize("embeddedContent.fileInfoHeader", "# File {0}\r\n", displayFileName);
        markDownContent = markDownContent.concat(localize("embeddedContent.fileInfoHeader", "Total bytes {0}\r\n", this.contentBuffer.length));
        markDownContent =  markDownContent.concat(BinaryContentRenderer.binaryDataMarkdownHeader);
        for (let bufferIndex: number = 0; bufferIndex < this.contentBuffer.length; bufferIndex++) {
            const bufferByte: number = this.contentBuffer[bufferIndex];
            if (bufferIndex % BinaryContentRenderer.bytesPerRow === 0) {
                markDownContent = markDownContent.concat(`\r\n|0x${bufferIndex < 16 ? '0' : ''}${bufferIndex.toString(16)}`);
            }

            markDownContent = markDownContent.concat(`|0x${bufferByte < 16 ? '0' : ''}${bufferByte.toString(16)}${((bufferIndex + 1) % BinaryContentRenderer.bytesPerRow === 0) ? '|\r\n' : ''}`);
        }

        return markDownContent;
    }

    public rangeFromOffsetAndLength(startOffset: number, length: number): vscode.Range {
        const endOffset: number = startOffset + length;
        let startRow: number = (startOffset % BinaryContentRenderer.bytesPerRow);
        let endRowOw: number = (endOffset % BinaryContentRenderer.bytesPerRow);
        let startColumn: number = startOffset - (startRow * BinaryContentRenderer.bytesPerRow);
        let endColumn: number = endOffset - (endRowOw * BinaryContentRenderer.bytesPerRow);

        // Offset by the known number of header rows.
        startRow = startRow + BinaryContentRenderer.headerRows;
        endRowOw = startRow + BinaryContentRenderer.headerRows;

        // Now for the "fun" part.
        // We know that our column offset starts at "1" because of the table cell marker (|),
        // and that each value will take 4" bytes (0x00)
        startColumn = startColumn + startColumn * BinaryContentRenderer.contentLengthPerTableCell + BinaryContentRenderer.markdownCellHeaderColumnOffset;
        endColumn = endColumn + endColumn * BinaryContentRenderer.contentLengthPerTableCell + BinaryContentRenderer.markdownCellHeaderColumnOffset;

        return new vscode.Range(startRow, startColumn, endRowOw, endColumn);
    }
}
