/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as vscode from 'vscode';
import * as sarif from 'sarif';

/**
 * Class used to render binary embedded content.
 */
export class BinaryContentRenderer {
    private static bytesPerRow: number = 8;
    private static headerRows: number = 4;
    private static markdownTableDelimiterLength: number = '|'.length;
    private static hexNumberPrefixLength: number = '0x'.length;
    private static hexNumberLength: number = 'ff'.length;
    private static contentLengthPerTableCell: number = BinaryContentRenderer.hexNumberPrefixLength + BinaryContentRenderer.hexNumberLength + BinaryContentRenderer.markdownTableDelimiterLength;
    private static binaryDataMarkdownHeader: string = localize("embeddedContent.tableHeader", "|Offset|0|1|2|3|4|5|6|7|\r\n|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|");

    /**
     * Creates an instance of the binary content renderer.
     * @param content The string contents to be rendered as markdown.
     */
    private constructor(private readonly content: string) {
    }

    /**
     * Attempts to create an instance of the binary content renderer based on a SARIF log, run index and artifact index
     * Returns undefined if the artifact contents cannot be found, or the content is not binary content.
     * @param log The SARIF log.
     * @param runIndex The run index.
     * @param artifactIndex The artifact index.
     */
    public static tryCreateFromLog(log: sarif.Log, runIndex: number, artifactIndex: number): BinaryContentRenderer | undefined {
        const run: sarif.Run | undefined = log.runs[runIndex];
        if (!run) {
            return undefined;
        }

        if (!run.artifacts) {
            return undefined;
        }

        const artifact: sarif.Artifact = run.artifacts[artifactIndex];
        if (!artifact) {
            return undefined;
        }

        if (!artifact.location) {
            return undefined;
        }

        if (!artifact.contents) {
            return undefined;
        }

        if (!artifact.contents.binary) {
            return undefined;
        }

        return new BinaryContentRenderer(artifact.contents.binary);
    }

    public renderAsMarkdown(displayFileName: string): string {
        const contentBuffer: Buffer = Buffer.from(this.content, 'base64');
        let markDownContent: string = localize("embeddedContent.fileInfoHeader", "# File {0}\r\n", displayFileName);
        markDownContent = markDownContent.concat(localize("embeddedContent.fileInfoHeader", "Total bytes {0}\r\n", contentBuffer.length));
        markDownContent =  markDownContent.concat(BinaryContentRenderer.binaryDataMarkdownHeader);
        for (let bufferIndex: number = 0; bufferIndex < contentBuffer.length; bufferIndex++) {
            const bufferByte: number = contentBuffer[bufferIndex];
            // When we hit the start of a new row, add the offset marker.
            if (bufferIndex % BinaryContentRenderer.bytesPerRow === 0) {
                markDownContent = markDownContent.concat(`\r\n|0x${bufferIndex < 16 ? '0' : ''}${bufferIndex.toString(16)}`);
            }

            // Add |0xFF, or |0xFF|\r\n depending on if we are at the end of a row.
            markDownContent = markDownContent.concat(`|0x${bufferByte < 16 ? '0' : ''}${bufferByte.toString(16)}${((bufferIndex + 1) % BinaryContentRenderer.bytesPerRow === 0) ? '|\r\n' : ''}`);
        }

        return markDownContent;
    }

    /**
     * Computes a range from the binary content based on the markdown it will render.
     * @param startOffset The start offset to compute the range from.
     * @param length The length of the desired range.
     */
    public rangeFromOffsetAndLength(startOffset: number, length: number): vscode.Range {
        // Convert the length into and end offset.
        const endOffset: number = startOffset + length;

        let startRow: number = Math.trunc((startOffset / BinaryContentRenderer.bytesPerRow));
        let endRowOw: number =  Math.trunc((endOffset / BinaryContentRenderer.bytesPerRow));
        let startColumn: number = startOffset - (startRow * BinaryContentRenderer.bytesPerRow);
        let endColumn: number = endOffset - (endRowOw * BinaryContentRenderer.bytesPerRow);

        // Offset by the known number of header rows.
        startRow = startRow + BinaryContentRenderer.headerRows;
        endRowOw = endRowOw + BinaryContentRenderer.headerRows;

        // Now for the "fun" part.
        // We know that our column offset starts at "1" because of the table cell marker (|),
        // and that each value will take 4" bytes (0x00), and then the "offset" content we place.
        // To calculate the offset length, we need the number of hexadecimal digits (value/16) +
        // 2 for the '0x' string and then two more characters for the markdown table delimiter.
        const offsetMarkerDigits: number = startOffset < 16 ? 2 : Math.trunc((startOffset / 16));
        const offsetMarkerLength: number = offsetMarkerDigits + BinaryContentRenderer.hexNumberPrefixLength + BinaryContentRenderer.markdownTableDelimiterLength * 2;
        startColumn = startColumn * BinaryContentRenderer.contentLengthPerTableCell + offsetMarkerLength;
        endColumn = (endColumn * BinaryContentRenderer.contentLengthPerTableCell + offsetMarkerLength) - 1 /*No need to include table delimiter*/;

        return new vscode.Range(startRow, startColumn, endRowOw, endColumn);
    }
}
