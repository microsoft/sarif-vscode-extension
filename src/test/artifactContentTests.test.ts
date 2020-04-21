/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as sarif from "sarif";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { ArtifactContentFileSystemProvider } from "../artifactContentFileSystemProvider";
import { BinaryArtifactContentRenderer } from "../artifactContentRenderers/binaryArtifactContentRenderer";
import { tryCreateRendererForArtifactContent, ArtifactContentRenderer } from "../artifactContentRenderers/artifactContentRenderer";

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
    let embeddedContentFileSystemProvider: ArtifactContentFileSystemProvider;
    const textContent: string = Date.now().toString();
    const textContentAsBuffer = new Buffer(textContent);
    const textContentAsBinary: string = textContentAsBuffer.toString('base64');
    const eightByteBinaryContent = new Buffer("12345678");
    const eightByteBinaryContentAsBinary: string = eightByteBinaryContent.toString('base64');
    const textContentArtifactIndex: number = 0;
    const binaryContentArtifactIndex: number = 1;
    const textAndBinaryContentArtifactIndex: number = 2;
    const eightByteContentArtifactIndex: number = 3;
    const lineEnding: string = os.platform() === 'win32' ? '\r\n' : '\n';

    this.beforeEach( function(this: Mocha.Context): void  {
        embeddedContentFileSystemProvider = new ArtifactContentFileSystemProvider();
    });

    this.afterEach( function(this: Mocha.Context): void  {
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
    
    const textContentArtifactContent: sarif.ArtifactContent = log.runs[0].artifacts![textContentArtifactIndex].contents!;
    const binaryContentArtifactContent: sarif.ArtifactContent = log.runs[0].artifacts![binaryContentArtifactIndex].contents!;
    const eightByteContentArtifactContent: sarif.ArtifactContent = log.runs[0].artifacts![eightByteContentArtifactIndex].contents!;

    test("Valid Run and Artifact Index", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 0, textContentArtifactIndex, undefined);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        assert.equal(doc.getText(), textContent);
    });

    test("Valid Run and Invalid Artifact Index", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 0, 15, undefined);

        assert.equal(embeddedUri, undefined);
    });

    test("Invalid Valid Run and Invalid Artifact Index", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 15, 15, undefined);

        assert.equal(embeddedUri, undefined);
    });

    test("Test prefer text over binary content", async () => {
        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, vscode.Uri.parse("readme.txt"), 0, textAndBinaryContentArtifactIndex, undefined);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        assert.equal(doc.getText(), textContent);
    });

    test("Test binary content test header", async () => {
        BinaryArtifactContentRenderer.bytesRenderedPerRowOverride = 16;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.path}${lineEnding}` +
        `Total bytes ${textContentAsBuffer.length}${lineEnding}` +
        `|Offset|0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|Data|${lineEnding}` +
        `|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|${lineEnding}`;

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const artifactContentRenderer: ArtifactContentRenderer | undefined = tryCreateRendererForArtifactContent(log, textContentArtifactContent);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, binaryContentArtifactIndex,artifactContentRenderer?.specificUriExtension);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        if (!docText.startsWith(expectedMarkdown)) {
            assert.fail('Header in markdown rendering is not correct.');
        }
    });

    test("Test binary content test header 1 byte per row", async () => {
        BinaryArtifactContentRenderer.bytesRenderedPerRowOverride = 1;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.path}${lineEnding}` +
        `Total bytes ${textContentAsBuffer.length}${lineEnding}` + 
        `|Offset|0|Data|${lineEnding}` +
        `|:---:|:---:|:---:|${lineEnding}`;

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const artifactContentRenderer: ArtifactContentRenderer | undefined = tryCreateRendererForArtifactContent(log, binaryContentArtifactContent);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, binaryContentArtifactIndex, artifactContentRenderer?.specificUriExtension);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        if (!docText.startsWith(expectedMarkdown)) {
            assert.fail('Header in markdown rendering is not correct.');
        }
    });

    test("Test binary content test header 2 byte per row", async () => {
        BinaryArtifactContentRenderer.bytesRenderedPerRowOverride = 2;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.path}${lineEnding}` +
        `Total bytes ${textContentAsBuffer.length}${lineEnding}` + 
        `|Offset|0|1|Data|${lineEnding}` +
        `|:---:|:---:|:---:|:---:|${lineEnding}`;

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const artifactContentRenderer: ArtifactContentRenderer | undefined = tryCreateRendererForArtifactContent(log, binaryContentArtifactContent);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, binaryContentArtifactIndex, artifactContentRenderer?.specificUriExtension);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        if (!docText.startsWith(expectedMarkdown)) {
            assert.fail('Header in markdown rendering is not correct.');
        }
    });

    test("Test binary content rendering 3 byte per row", async () => {
        BinaryArtifactContentRenderer.bytesRenderedPerRowOverride = 3;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.path}${lineEnding}` +
        `Total bytes ${eightByteBinaryContent.length}${lineEnding}` + 
        `|Offset|0|1|2|Data|${lineEnding}` +
        `|:---:|:---:|:---:|:---:|:---:|${lineEnding}` + 
        `|0x00|0x31|0x32|0x33|123|${lineEnding}` +
        `|0x03|0x34|0x35|0x36|456|${lineEnding}` +
        `|0x06|0x37|0x38||78|${lineEnding}`;


        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const artifactContentRenderer: ArtifactContentRenderer | undefined = tryCreateRendererForArtifactContent(log, eightByteContentArtifactContent);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex, artifactContentRenderer?.specificUriExtension);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);
    });

    test("Test binary content rendering 1 byte per row", async () => {
        BinaryArtifactContentRenderer.bytesRenderedPerRowOverride = 1;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.path}${lineEnding}` +
        `Total bytes ${eightByteBinaryContent.length}${lineEnding}` + 
        `|Offset|0|Data|${lineEnding}` +
        `|:---:|:---:|:---:|${lineEnding}` + 
        `|0x00|0x31|1|${lineEnding}` +
        `|0x01|0x32|2|${lineEnding}` +
        `|0x02|0x33|3|${lineEnding}` +
        `|0x03|0x34|4|${lineEnding}` +
        `|0x04|0x35|5|${lineEnding}` +
        `|0x05|0x36|6|${lineEnding}` +
        `|0x06|0x37|7|${lineEnding}` +
        `|0x07|0x38|8|${lineEnding}`;

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const artifactContentRenderer: ArtifactContentRenderer | undefined = tryCreateRendererForArtifactContent(log, eightByteContentArtifactContent);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex, artifactContentRenderer?.specificUriExtension);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);
    });

    test("Test binary content rendering eight bytes per row (single row)", async () => {
        BinaryArtifactContentRenderer.bytesRenderedPerRowOverride = 8;
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.path}${lineEnding}` +
        `Total bytes ${eightByteBinaryContent.length}${lineEnding}` + 
        `|Offset|0|1|2|3|4|5|6|7|Data|${lineEnding}` +
        `|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|${lineEnding}` + 
        `|0x00|0x31|0x32|0x33|0x34|0x35|0x36|0x37|0x38|12345678|${lineEnding}`;

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const artifactContentRenderer: ArtifactContentRenderer | undefined = tryCreateRendererForArtifactContent(log, eightByteContentArtifactContent);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex, artifactContentRenderer?.specificUriExtension);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);
    });

    test("Test binary content offset mapping at 3 byte per row", async () => {
        BinaryArtifactContentRenderer.bytesRenderedPerRowOverride = 3;
        const binaryContentRenderer: ArtifactContentRenderer | undefined = BinaryArtifactContentRenderer.tryCreateFromLog(log, eightByteContentArtifactContent);
        assert.notEqual(binaryContentRenderer, undefined);
        if (!binaryContentRenderer) {
            return;
        }

        // We don't really need to verify or use this text for this test, but it helps to understand the test.
        const artifactUri: vscode.Uri = vscode.Uri.parse('readme.txt');
        const expectedMarkdown: string = 
        `# File ${artifactUri.path}${lineEnding}` +
        `Total bytes ${eightByteBinaryContent.length}${lineEnding}` + 
        `|Offset|0|1|2|Data|${lineEnding}` +
        `|:---:|:---:|:---:|:---:|:---:|${lineEnding}` + 
        `|0x00|0x31|0x32|0x33|123|${lineEnding}` +
        `|0x03|0x34|0x35|0x36|456|${lineEnding}` +
        `|0x06|0x37|0x38||78|${lineEnding}`;

        const logFileUri: vscode.Uri = writeSarifLogToTempFile(log);
        const embeddedUri: vscode.Uri | undefined =  ArtifactContentFileSystemProvider.tryCreateUri(log, logFileUri, artifactUri, 0, eightByteContentArtifactIndex, binaryContentRenderer?.specificUriExtension);

        assert.notEqual(embeddedUri, undefined);

        const doc: vscode.TextDocument  = await vscode.workspace.openTextDocument(embeddedUri!);
        const docText: string = doc.getText();
        assert.strictEqual(docText, expectedMarkdown);

        assert.notEqual(binaryContentRenderer.rangeFromRegion, undefined);
        if (!binaryContentRenderer.rangeFromRegion) {
            return;
        }

        // Test completely invalid range and offset.
        let testRange: vscode.Range | undefined = binaryContentRenderer.rangeFromRegion({byteOffset: -1, byteLength: 100});
        assert.equal(testRange, undefined);

        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 0, byteLength: -1});
        assert.equal(testRange, undefined);

        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: -1, byteLength: 0});
        assert.equal(testRange, undefined);

        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 0, byteLength: 0});
        assert.equal(testRange, undefined);

        // Test the first byte.
        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 0, byteLength: 1});
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 4);
        assert.equal(testRange.start.character, 6);
        assert.equal(testRange.end.line, 4);
        assert.equal(testRange.end.character, 10);

        // Test the last byte.
        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 7, byteLength: 1});
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 6);
        assert.equal(testRange.start.character, 11);
        assert.equal(testRange.end.line, 6);
        assert.equal(testRange.end.character, 15);

        // Test the middle of first row.
        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 4, byteLength: 1});
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 5);
        assert.equal(testRange.start.character, 11);
        assert.equal(testRange.end.line, 5);
        assert.equal(testRange.end.character, 15);

        // Entire  first row.
        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 0, byteLength: 3});
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 4);
        assert.equal(testRange.start.character, 6);
        assert.equal(testRange.end.line, 4);
        assert.equal(testRange.end.character, 20);

        // First and second row.
        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 0, byteLength: 6});
        assert.notEqual(testRange, undefined);
        if (!testRange) {
            return;
        }

        assert.equal(testRange.start.line, 4);
        assert.equal(testRange.start.character, 6);
        assert.equal(testRange.end.line, 5);
        assert.equal(testRange.end.character, 20);

        // Middle of first row to middle of second row.
        testRange = binaryContentRenderer.rangeFromRegion({byteOffset: 1, byteLength: 4});
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