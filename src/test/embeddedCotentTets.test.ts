/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as sarif from "sarif";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { EmbeddedContentFileSystemProvider } from "./../embeddedContentFileSystemProvider";
import { BinaryContentRenderer } from "../binaryContentRenderer";

function writeSarifLogToTempFile(log: sarif.Log): vscode.Uri {
    const createPath: string = path.join(os.tmpdir(), 'embeddedContentTests');
    if (!fs.existsSync(createPath)) {
        fs.mkdirSync(createPath);
    }

    const logPath: string = path.join(createPath, `${Date.now().toString()}.sarif`);
    fs.writeFileSync(logPath, JSON.stringify(log));
    return vscode.Uri.file(logPath);
}

suite("testEmbeddedContent",async function (this: Mocha.Suite): Promise<void> {
    let embeddedContentFileSystemProvider: EmbeddedContentFileSystemProvider;
    const textContent: string = Date.now().toString();
    const textContentAsBuffer = new Buffer(textContent);
    const textContentAsBinary: string = textContentAsBuffer.toString('base64');
    const eightByteBinaryContent = new Buffer("12345678");
    const eightByteBinaryContentAsBinary: string = eightByteBinaryContent.toString('base64');
    const textContentArtifactIndex: number = 0;
    const textAndBinaryContentArtifactIndex: number = 2;
    const binaryContentArtifactIndex: number = 1;
    const eightByteContentArtifactIndex: number = 3;

    this.beforeAll( function(this: Mocha.Context): void  {
        embeddedContentFileSystemProvider = new EmbeddedContentFileSystemProvider();
    });

    this.afterAll( function(this: Mocha.Context): void  {
        embeddedContentFileSystemProvider.dispose();
    });

    const log: sarif.Log = {
        version: "2.1.0",
        $schema: "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json",
        runs: [
            {
                tool: { driver: { name: "Test Me", } },
                artifacts: [
                    { contents: { text: textContent } },
                    { contents: { binary: textContentAsBinary } },
                    { contents: { text: textContent, binary: textContentAsBinary } },
                    { contents: { binary: eightByteBinaryContentAsBinary } }
                ]
            }
        ]
    };
    
    test("Valid Run and Artifact Index", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 0, textContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        assert.equal(doc.getText(), textContent);
    });

    test("Valid Run and Invalid Artifact Index", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 0, 15);

        assert.equal(embeddedUri, undefined);
    });

    test("Invalid Valid Run and Invalid Artifact Index", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 15, 15);

        assert.equal(embeddedUri, undefined);
    });

    test("Test prefer text over binary content", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 0, textAndBinaryContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        assert.equal(doc.getText(), textContent);
    });

    test("Test binary content test header", async () => {
        BinaryContentRenderer.bytesPerRow = 16;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.toString()}\r\n` +
        `Total bytes ${textContentAsBuffer.length}\r\n` + 
        "|Offset|0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|Data|\r\n" +
        "|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|\r\n";

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, binaryContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        if (!docText.startsWith(expectedMarkdown)) {
            assert.fail('Header in markdown rendering is not correct.');
        }
    });

    test("Test binary content test header 1 byte per row", async () => {
        BinaryContentRenderer.bytesPerRow = 1;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.toString()}\r\n` +
        `Total bytes ${textContentAsBuffer.length}\r\n` + 
        "|Offset|0|Data|\r\n" +
        "|:---:|:---:|:---:|\r\n";

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, binaryContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        if (!docText.startsWith(expectedMarkdown)) {
            assert.fail('Header in markdown rendering is not correct.');
        }
    });

    test("Test binary content test header 2 byte per row", async () => {
        BinaryContentRenderer.bytesPerRow = 2;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.toString()}\r\n` +
        `Total bytes ${textContentAsBuffer.length}\r\n` + 
        "|Offset|0|1|Data|\r\n" +
        "|:---:|:---:|:---:|:---:|\r\n";

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, binaryContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        if (!docText.startsWith(expectedMarkdown)) {
            assert.fail('Header in markdown rendering is not correct.');
        }
    });

    test("Test binary content rendering 3 byte per row", async () => {
        BinaryContentRenderer.bytesPerRow = 3;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.toString()}\r\n` +
        `Total bytes ${eightByteBinaryContent.length}\r\n` + 
        "|Offset|0|1|2|Data|\r\n" +
        "|:---:|:---:|:---:|:---:|:---:|\r\n" + 
        "|0x00|0x31|0x32|0x33|123|\r\n" +
        "|0x03|0x34|0x35|0x36|456|\r\n" +
        "|0x06|0x37|0x38||78|\r\n";


        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);
    });

    test("Test binary content rendering 1 byte per row", async () => {
        BinaryContentRenderer.bytesPerRow = 1;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.toString()}\r\n` +
        `Total bytes ${eightByteBinaryContent.length}\r\n` + 
        "|Offset|0|Data|\r\n" +
        "|:---:|:---:|:---:|\r\n" + 
        "|0x00|0x31|1|\r\n" +
        "|0x01|0x32|2|\r\n" +
        "|0x02|0x33|3|\r\n" +
        "|0x03|0x34|4|\r\n" +
        "|0x04|0x35|5|\r\n" +
        "|0x05|0x36|6|\r\n" +
        "|0x06|0x37|7|\r\n" +
        "|0x07|0x38|8|\r\n";

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);
    });

    test("Test binary content rendering eight bytes per row (single row)", async () => {
        BinaryContentRenderer.bytesPerRow = 8;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.toString()}\r\n` +
        `Total bytes ${eightByteBinaryContent.length}\r\n` + 
        "|Offset|0|1|2|3|4|5|6|7|Data|\r\n" +
        "|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|\r\n" + 
        "|0x00|0x31|0x32|0x33|0x34|0x35|0x36|0x37|0x38|12345678|\r\n";

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);
    });

    test("Test binary content offset mapping at 3 byte per row", async () => {
        BinaryContentRenderer.bytesPerRow = 3;
        const binaryContentRenderer: BinaryContentRenderer | undefined = BinaryContentRenderer.tryCreateFromLog(log, 0, eightByteContentArtifactIndex);
        assert.notEqual(binaryContentRenderer, undefined);
        if (!binaryContentRenderer) {
            return;
        }

        // We don't really need to verify or use this text for this test, but it helps to understand the test.
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.toString()}\r\n` +
        `Total bytes ${eightByteBinaryContent.length}\r\n` + 
        "|Offset|0|1|2|Data|\r\n" +
        "|:---:|:---:|:---:|:---:|:---:|\r\n" + 
        "|0x00|0x31|0x32|0x33|123|\r\n" +
        "|0x03|0x34|0x35|0x36|456|\r\n" +
        "|0x06|0x37|0x38||78|\r\n";

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  EmbeddedContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);

        // Test completely invalid range and offset.
        let testRange: vscode.Range | undefined = binaryContentRenderer.rangeFromOffsetAndLength(-1, 100);
        assert.equal(testRange, undefined);

        testRange = binaryContentRenderer.rangeFromOffsetAndLength(0, -1);
        assert.equal(testRange, undefined);

        testRange = binaryContentRenderer.rangeFromOffsetAndLength(-1, 0);
        assert.equal(testRange, undefined);

        testRange = binaryContentRenderer.rangeFromOffsetAndLength(0, 0);
        assert.equal(testRange, undefined);

        // Test the first byte.
        testRange = binaryContentRenderer.rangeFromOffsetAndLength(0, 1);
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 4);
        assert.equal(testRange.start.character, 6);
        assert.equal(testRange.end.line, 4);
        assert.equal(testRange.end.character, 10);

        // Test the last byte.
        testRange = binaryContentRenderer.rangeFromOffsetAndLength(7, 1);
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 6);
        assert.equal(testRange.start.character, 11);
        assert.equal(testRange.end.line, 6);
        assert.equal(testRange.end.character, 15);

        // Test the middle of first row.
        testRange = binaryContentRenderer.rangeFromOffsetAndLength(4, 1);
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 5);
        assert.equal(testRange.start.character, 11);
        assert.equal(testRange.end.line, 5);
        assert.equal(testRange.end.character, 15);

        // Entire  first row.
        testRange = binaryContentRenderer.rangeFromOffsetAndLength(0, 3);
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 4);
        assert.equal(testRange.start.character, 6);
        assert.equal(testRange.end.line, 4);
        assert.equal(testRange.end.character, 20);

        // First and second row.
        testRange = binaryContentRenderer.rangeFromOffsetAndLength(0, 6);
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 4);
        assert.equal(testRange.start.character, 6);
        assert.equal(testRange.end.line, 5);
        assert.equal(testRange.end.character, 20);

        // Middle of first row to middle of second row.
        testRange = binaryContentRenderer.rangeFromOffsetAndLength(1, 4);
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 4);
        assert.equal(testRange.start.character, 11);
        assert.equal(testRange.end.line, 5);
        assert.equal(testRange.end.character, 15);
    });
});