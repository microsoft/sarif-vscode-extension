/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
import * as vscode from 'vscode';
import * as sarif from 'sarif';
import MarkdownIt = require("markdown-it");

/**
 * Class used to render embedded binary content.
 */
export class BinaryContentRenderer {
    private static bytesPerRow: number = 8;
    private static headerRows: number = 4;
    private static markdownTableDelimiterLength: number = '|'.length;
    private static hexNumberPrefixLength: number = '0x'.length;
    private static hexNumberLength: number = 'ff'.length;
    private static contentLengthPerTableCell: number = BinaryContentRenderer.hexNumberPrefixLength + BinaryContentRenderer.hexNumberLength + BinaryContentRenderer.markdownTableDelimiterLength;
    private static headerColumnStyle: string = ':---:';
    private static headerCellDelimiter: string = '|';

    /**
     * Creates an instance of the binary content renderer.
     * @param content The string contents to be rendered as markdown.
     */
    private constructor(private readonly content: string) {
    }

    /**
     * Creates a header for binary content represented as mark down.
     * For a 16 bytes per row table, it generates this:
     * |Offset|0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|Data|
     * |:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
     */
    private createTableHeader(): string {
        // Start with the Offset column.
        const headerColumns: string[] = [BinaryContentRenderer.headerCellDelimiter, `${localize("embeddedContent.tableHeader", "Offset")}`];
        const headerTableDelimiters: string[] = [BinaryContentRenderer.headerCellDelimiter, BinaryContentRenderer.headerColumnStyle];

        // Create the table header and the header\row delimiter at the same time.
        for (let columnIndex: number = 0; columnIndex < BinaryContentRenderer.bytesPerRow; columnIndex++) {
            headerColumns.push(BinaryContentRenderer.headerCellDelimiter);
            headerColumns.push(columnIndex.toString());

            headerTableDelimiters.push(BinaryContentRenderer.headerCellDelimiter);
            headerTableDelimiters.push(BinaryContentRenderer.headerColumnStyle);
        }

        // Add the data column to the header.
        headerColumns.push(BinaryContentRenderer.headerCellDelimiter);
        headerColumns.push(`${localize("embeddedContent.dataHeader", "Data")}`);
        headerColumns.push(BinaryContentRenderer.headerCellDelimiter);

        // Add the data column to the header\row delimiter.
        headerTableDelimiters.push(BinaryContentRenderer.headerCellDelimiter);
        headerTableDelimiters.push(BinaryContentRenderer.headerColumnStyle);
        headerTableDelimiters.push(BinaryContentRenderer.headerCellDelimiter);

        // Now join them all together.
        return `${headerColumns.join('')}\r\n${headerTableDelimiters.join('')}\r\n`;
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

    private static valueAsHexDisplayString(byte: number): string {
        const truncatedByte: number = Math.trunc(byte);
        if (truncatedByte < 0 || truncatedByte > 255) {
            throw new Error('Must be a value between [0, 255]');
        }

        return `0x${truncatedByte < 16 ? '0' : ''}${truncatedByte.toString(16)}`;
    }

    public renderAsMarkdown(displayFileName: string): string {
        const markdownStrings: string[] = [];
        const mdIt: MarkdownIt = new MarkdownIt();
        const contentBuffer: Buffer = Buffer.from(this.content, 'base64');
        markdownStrings.push(localize("embeddedContent.fileInfoHeader", "# File {0}\r\n", displayFileName));
        markdownStrings.push(localize("embeddedContent.fileInfoHeader", "Total bytes {0}\r\n", contentBuffer.length));
        markdownStrings.push(this.createTableHeader());

        // This is used as an index into the buffer for where the next
        // string representation of the data bytes will come from.
        let dataStringBufferIndex: number = 0;

        for (let bufferIndex: number = 0; bufferIndex < contentBuffer.length; bufferIndex++) {
            const bufferByte: number = contentBuffer[bufferIndex];

            // When we hit the start of a new row, add the offset marker.
            if (bufferIndex % BinaryContentRenderer.bytesPerRow === 0) {
                markdownStrings.push(BinaryContentRenderer.headerCellDelimiter);
                markdownStrings.push(BinaryContentRenderer.valueAsHexDisplayString(bufferIndex));
            }

            // Add |0xFF, or |0xFF|\r\n depending on if we are at the end of a row.
            const nextIndex: number = bufferIndex + 1;
            if (nextIndex % BinaryContentRenderer.bytesPerRow === 0 || nextIndex === contentBuffer.length) {
                markdownStrings.push(BinaryContentRenderer.headerCellDelimiter);
                markdownStrings.push(BinaryContentRenderer.valueAsHexDisplayString(bufferByte));

                // Pad out the row of bytes if needed (happens at the end of the content)
                let bytePaddingIndex: number = nextIndex;
                while (bytePaddingIndex % BinaryContentRenderer.bytesPerRow !== 0) {
                    markdownStrings.push(BinaryContentRenderer.headerCellDelimiter);
                    bytePaddingIndex++;
                }

                // Finish off the data bytes, and start the data string representation.
                markdownStrings.push(BinaryContentRenderer.headerCellDelimiter);

                // Covert the binary data into a string
                let dataString: string = '';
                for (let dataIndex: number = dataStringBufferIndex; dataIndex < (dataStringBufferIndex + BinaryContentRenderer.bytesPerRow) && dataIndex < contentBuffer.length; dataIndex++) {
                    const stringFromCharCode: string = String.fromCharCode(contentBuffer[dataIndex]);
                    dataString = dataString.concat(stringFromCharCode);
                }

                dataStringBufferIndex +=  BinaryContentRenderer.bytesPerRow;

                // Use mark-down it to escape anything that may affect the markdown (such as new-lines, etc.)
                dataString = dataString.replace('\r', '-');
                dataString = dataString.replace('\n', '-');
                const mdText: string = mdIt.renderInline(dataString);

                markdownStrings.push(mdText);
                markdownStrings.push(BinaryContentRenderer.headerCellDelimiter);
                markdownStrings.push('\r\n');

            } else {
                markdownStrings.push(BinaryContentRenderer.headerCellDelimiter);
                markdownStrings.push(BinaryContentRenderer.valueAsHexDisplayString(bufferByte));
            }
        }

        return markdownStrings.join('');
    }

    /**
     * Computes a range from the binary content based on the markdown it will render.
     * @param startOffset The start offset to compute the range from.
     * @param length The length of the desired range.
     */
    public rangeFromOffsetAndLength(startOffset: number, length: number): vscode.Range {
        let startRow: number = Math.trunc(startOffset / BinaryContentRenderer.bytesPerRow);
        let startColumn: number = startOffset % BinaryContentRenderer.bytesPerRow;

        // The end offset is not inclusive of the length.
        // A offset of 0 and length o 1, yields a start and end that are the same.
        const endOffset: number = (startOffset + length) - 1;
        let endRow: number = Math.trunc(endOffset / BinaryContentRenderer.bytesPerRow);
        // We adjust the column by because a length of 1 doesn't mean
        // highlight nothing.
        let endColumn: number = (endOffset % BinaryContentRenderer.bytesPerRow) + 1;

        // Offset by the known number of header rows in the markdown.
        startRow = startRow + BinaryContentRenderer.headerRows;
        endRow = endRow + BinaryContentRenderer.headerRows;

        // Now for the "fun" part.
        // We know that our column offset starts at "1" because of the table cell marker (|),
        // and that each value will take 4" bytes (0x00), and then the "offset" content we place.
        // To calculate the offset length, we need the number of hexadecimal digits (value/16) +
        // 2 for the '0x' string and then two more characters for the markdown table delimiter.
        const offsetMarkerDigits: number = startOffset < 16 ? 2 : Math.trunc((startOffset / 16));
        const offsetMarkerLength: number = offsetMarkerDigits + BinaryContentRenderer.hexNumberPrefixLength + BinaryContentRenderer.markdownTableDelimiterLength * 2;
        startColumn = startColumn * BinaryContentRenderer.contentLengthPerTableCell + offsetMarkerLength;
        endColumn = endColumn * BinaryContentRenderer.contentLengthPerTableCell + offsetMarkerLength;

        return new vscode.Range(startRow, startColumn, endRow, endColumn);
    }
}
