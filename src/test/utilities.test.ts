/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

// The module 'assert' provides assertion methods from node
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sarif from "sarif";

import { Range, Uri } from "vscode";
import { Location, RunInfo } from "../common/Interfaces";
import { SVDiagnosticCollection } from "../SVDiagnosticCollection";
import { Utilities } from "../Utilities";

suite("combineUriWithUriBase", () => {
    const expectedFileSchema = "file";
    test("Empty paths", () => {
        const uri = Utilities.combineUriWithUriBase("", "");
        assert.equal(uri.scheme, expectedFileSchema);
        assert.equal(uri.fsPath, "\\");
    });

    test("Undefined base", () => {
        const uri = Utilities.combineUriWithUriBase("file:///c:/folder/file.ext", undefined);
        assert.equal(uri.scheme, expectedFileSchema);
        assert.equal(uri.fsPath, "c:\\folder\\file.ext");
    });

    test("Path with uri id base", () => {
        const uriPath = "\\folder\\file.ext";
        let uri = Utilities.combineUriWithUriBase(uriPath, "%srcroot%");
        assert.equal(uri.scheme, expectedFileSchema);
        assert.equal(uri.fsPath, "\\%srcroot%" + uriPath);
        uri = Utilities.combineUriWithUriBase(uriPath, "#srcroot#");
        assert.equal(uri.scheme, expectedFileSchema);
        assert.equal(uri.fsPath, "\\#srcroot#" + uriPath);
    });

    test("Path With basepath ", () => {
        const expectedPath = "c:\\folder1\\folder2\\file.ext";
        const uriPath = "folder2/file.ext";
        const uriBasePath = "file:///c:/folder1";
        let uri = Utilities.combineUriWithUriBase(uriPath, uriBasePath);
        assert.equal(uri.scheme, expectedFileSchema);
        assert.equal(uri.fsPath, expectedPath);
        uri = Utilities.combineUriWithUriBase("/" + uriPath, uriBasePath);
        assert.equal(uri.scheme, expectedFileSchema);
        assert.equal(uri.fsPath, expectedPath);
        uri = Utilities.combineUriWithUriBase("/" + uriPath, uriBasePath + "/");
        assert.equal(uri.scheme, expectedFileSchema);
        assert.equal(uri.fsPath, expectedPath);
    });

    test ("Fix path casing", () => {
        const directoryEntries: string[] = fs.readdirSync(__dirname);
        for (const directoryEntry of directoryEntries) {
            const lowerCasedDirectory: string = path.join(__dirname, directoryEntry).toLowerCase();
            assert.equal(path.join(__dirname, directoryEntry),
                Utilities.fixUriCasing(Uri.file(lowerCasedDirectory)).fsPath);
            const upperCasedPath: string = path.join(__dirname, directoryEntry).toUpperCase();
            assert.equal(path.join(__dirname, directoryEntry),
                Utilities.fixUriCasing(Uri.file(upperCasedPath)).fsPath);
            }
    });
});

suite("parseSarifMessages", () => {
    const locations1 = [
        {
            endOfLine: false,
            fileName: "file.ext",
            id: 0,
            mapped: true,
            message: undefined,
            range: new Range(1, 1, 2, 2),
            uri: Uri.file("c:/folder/file.ext"),
            uriBase: undefined,
        } as Location,
    ];

    const locations2 = [
        {
            endOfLine: false,
            fileName: "file.ext",
            id: 1,
            mapped: true,
            message: undefined,
            range: new Range(1, 1, 2, 2),
            uri: Uri.file("c:/folder/file.ext"),
            uriBase: undefined,
        } as Location,
        {
            endOfLine: false,
            fileName: "file1.ext",
            id: 0,
            mapped: true,
            message: undefined,
            range: new Range(3, 3, 4, 4),
            uri: Uri.file("c:/folder1/file1.ext"),
            uriBase: undefined,
        } as Location,
    ];

    test("Undefined message", () => {
        const message = Utilities.parseSarifMessage(undefined);
        assert.deepEqual(message, {});
    });

    test("Empty string", () => {
        const inputText = "";
        const sarifMessage = { text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage);
        assert.equal(message.text, inputText);
        assert.equal(message.html, inputText);
    });

    test("Simple string", () => {
        const inputText = "A simple string";
        const outputHTML = `<p>${inputText}</p>\n`;
        const sarifMessage = { text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage);
        assert.equal(message.text, inputText);
        assert.equal(message.html, outputHTML);
    });

    test("Simple argument", () => {
        const inputText = "A string with {0} argument";
        const inputArguments = ["1"];
        const outputText = "A string with 1 argument";
        const outputHtml = `<p>${outputText}</p>\n`;
        const sarifMessage = { arguments: inputArguments, text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Multiple arguments", () => {
        const inputText = "A string with {0} arguments, from {1} code for {2}.";
        const inputArguments = ["3", "test", "testing"];
        const outputText = "A string with 3 arguments, from test code for testing.";
        const outputHtml = `<p>${outputText}</p>\n`;
        const sarifMessage = { arguments: inputArguments, text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Argument used twice", () => {
        const inputText = "{0} string with {0} argument";
        const inputArguments = ["1"];
        const outputText = "1 string with 1 argument";
        const outputHtml = `<p>${outputText}</p>\n`;
        const sarifMessage = { arguments: inputArguments, text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Simple embedded link", () => {
        const inputText = "A string with [Embedded](0) links";
        const outputText = "A string with Embedded(file:///c:/folder/file.ext) links";
        const start = locations1[0].range.start;
        const end = locations1[0].range.end;
        const file = locations1[0].uri.toString(true);
        const outputHtml =
            `<p>A string with <a href="#0" class="sourcelink" data-file="${file}" ` +
            `data-sLine="${start.line}" data-sCol="${start.character}" ` +
            `data-eLine="${end.line}" data-eCol="${end.character}" ` +
            `title="${file}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">Embedded</a> links</p>\n`;
        const sarifMessage = { text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage, locations1);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Embedded link used twice", () => {
        const inputText = "[Embedded](0) Links: A string with duplicate [Embedded](0) links";
        const outputText = "Embedded(file:///c:/folder/file.ext) Links: " +
            "A string with duplicate Embedded(file:///c:/folder/file.ext) links";
        const start = locations1[0].range.start;
        const end = locations1[0].range.end;
        const file = locations1[0].uri.toString(true);
        const outputHtml =
            `<p><a href="#0" class="sourcelink" data-file="${file}" ` +
            `data-sLine="${start.line}" data-sCol="${start.character}" ` +
            `data-eLine="${end.line}" data-eCol="${end.character}" ` +
            `title="${file}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">Embedded</a> Links: A string with duplicate ` +
            `<a href="#0" class="sourcelink" data-file="${file}" ` +
            `data-sLine="${start.line}" data-sCol="${start.character}" ` +
            `data-eLine="${end.line}" data-eCol="${end.character}" ` +
            `title="${file}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">Embedded</a> links</p>\n`;
        const sarifMessage = { text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage, locations1);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Two out of order embedded links", () => {
        const inputText = "A string with two Embedded Links: [link1](1) [link2](0)";
        const outputText = "A string with two Embedded Links: link1(file:///c:/folder/file.ext)" +
            " link2(file:///c:/folder1/file1.ext)";
        const start1 = locations2[0].range.start;
        const end1 = locations2[0].range.end;
        const file1 = locations2[0].uri.toString(true);
        const start2 = locations2[1].range.start;
        const end2 = locations2[1].range.end;
        const file2 = locations2[1].uri.toString(true);
        const outputHtml =
            `<p>A string with two Embedded Links: <a href="#0" class="sourcelink" data-file="${file1}" ` +
            `data-sLine="${start1.line}" data-sCol="${start1.character}" ` +
            `data-eLine="${end1.line}" data-eCol="${end1.character}" ` +
            `title="${file1}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">link1</a> ` +
            `<a href="#0" class="sourcelink" data-file="${file2}" ` +
            `data-sLine="${start2.line}" data-sCol="${start2.character}" ` +
            `data-eLine="${end2.line}" data-eCol="${end2.character}" ` +
            `title="${file2}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">link2</a></p>\n`;
        const sarifMessage = { text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage, locations2);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Bracketed links", () => {
        const inputText = "Bracketed links: \\[[outside bracket](0)\\], [\\[inside bracket\\]](0)";
        const outputText = "Bracketed links: [outside bracket(file:///c:/folder/file.ext)]," +
            " [inside bracket](file:///c:/folder/file.ext)";
        const start = locations1[0].range.start;
        const end = locations1[0].range.end;
        const file = locations1[0].uri.toString(true);
        const outputHtml =
            `<p>Bracketed links: [` +
            `<a href="#0" class="sourcelink" data-file="${file}" ` +
            `data-sLine="${start.line}" data-sCol="${start.character}" ` +
            `data-eLine="${end.line}" data-eCol="${end.character}" ` +
            `title="${file}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">outside bracket</a>` +
            `], ` +
            `<a href="#0" class="sourcelink" data-file="${file}" ` +
            `data-sLine="${start.line}" data-sCol="${start.character}" ` +
            `data-eLine="${end.line}" data-eCol="${end.character}" ` +
            `title="${file}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">[inside bracket]</a></p>\n`;
        const sarifMessage = { text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage, locations1);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Embedded link with no location", () => {
        const inputText = "A string with an [Embedded](0) link.";
        const outputText = "A string with an Embedded(0) link.";
        const outputHtml = `<p>A string with an <a href="0">Embedded</a> link.</p>\n`;
        const sarifMessage = { text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });

    test("Argument and embedded link", () => {
        const inputText = "A string with {0} argument and an [Embedded](0) link.";
        const inputArguments = ["1"];
        const outputText = "A string with 1 argument and an Embedded(file:///c:/folder/file.ext) link.";
        const start = locations1[0].range.start;
        const end = locations1[0].range.end;
        const file = locations1[0].uri.toString(true);
        const outputHtml =
            `<p>A string with 1 argument and an ` +
            `<a href="#0" class="sourcelink" data-file="${file}" ` +
            `data-sLine="${start.line}" data-sCol="${start.character}" ` +
            `data-eLine="${end.line}" data-eCol="${end.character}" ` +
            `title="${file}" ` +
            `onclick="explorerWebview.onSourceLinkClickedBind(event)">Embedded</a> link.</p>\n`;
        const sarifMessage = { arguments: inputArguments, text: inputText } as sarif.Message;
        const message = Utilities.parseSarifMessage(sarifMessage, locations1);
        assert.equal(message.text, outputText);
        assert.equal(message.html, outputHtml);
    });
});

suite("getUirBase", () => {
    const runInfoTest = {} as RunInfo;
    runInfoTest.uriBaseIds = { test1: "file:///c:/folder1", test2: "file:///c:/folder2" };
    const runIdTest = SVDiagnosticCollection.Instance.addRunInfo(runInfoTest);

    test("Undefined fileLocation", () => {
        const base = Utilities.getUriBase(undefined, undefined);
        assert.equal(base, undefined);
    });

    test("Undefined uribaseid", () => {
        const sarifLocation = { uri: "file:///c:/folder/file.ext" } as sarif.ArtifactLocation;
        const base = Utilities.getUriBase(sarifLocation, runIdTest);
        assert.equal(base, undefined);
    });

    test("UriBase match", () => {
        const sarifLocation = { uri: "/file.ext", uriBaseId: "test2" } as sarif.ArtifactLocation;
        const base = Utilities.getUriBase(sarifLocation, runIdTest);
        assert.equal(base, "file:///c:/folder2");
    });

    test("No matching uribaseid", () => {
        const sarifLocation = { uri: "/file.ext", uriBaseId: "noTest" } as sarif.ArtifactLocation;
        const base = Utilities.getUriBase(sarifLocation, runIdTest);
        assert.equal(base, "noTest");
    });
});

suite("expandBaseIds", () => {
    const originalUriBaseIds = {
        file: { uri: "file.ext", uriBaseId: "folder" },
        folder: { uri: "folder", uriBaseId: "root" },
        networkFile: { uri: "file.ext", uriBaseId: "networkFolder" },
        networkFolder: { uri: "folder", uriBaseId: "networkRoot" },
        networkRoot: { uri: "file://network/" },
        root: { uri: "file:///c:/" },
    } as { [key: string]: sarif.ArtifactLocation };

    test("Undefined originalUriBaseIds", () => {
        const expandedBaseIds = Utilities.expandBaseIds(undefined);
        assert.equal(expandedBaseIds, undefined);
    });

    test("basic", () => {
        const expandedBaseIds = Utilities.expandBaseIds(originalUriBaseIds);
        assert.notEqual(expandedBaseIds, undefined);
        assert.deepEqual(expandedBaseIds, {
            file: "file:///c:/folder/file.ext",
            folder: "file:///c:/folder",
            networkFile: "file://network/folder/file.ext",
            networkFolder: "file://network/folder",
            networkRoot: "file://network/",
            root: "file:///c:/",
        });
    });
});

suite("calcDuration", () => {
    const startTime = "2016-07-16T14:18:25.000Z";
    test("Undefined times", () => {
        let duration = Utilities.calcDuration(undefined, undefined);
        assert.equal(duration, undefined);

        duration = Utilities.calcDuration(startTime, undefined);
        assert.equal(duration, undefined);

        duration = Utilities.calcDuration(undefined, startTime);
        assert.equal(duration, undefined);
    });

    test("Full Singular", () => {
        const duration = Utilities.calcDuration(startTime, "2016-07-16T15:19:26.001Z");
        assert.equal(duration, "1 hr 1 min 1 sec 1 ms");
    });

    test("Full Plural", () => {
        const duration = Utilities.calcDuration(startTime, "2016-07-16T16:21:27.004Z");
        assert.equal(duration, "2 hrs 3 mins 2 secs 4 ms");
    });

    test("Partial Durations", () => {
        let duration = Utilities.calcDuration(startTime, "2016-07-16T15:21:27.000Z");
        assert.equal(duration, "1 hr 3 mins 2 secs");

        duration = Utilities.calcDuration(startTime, "2016-07-16T14:21:27.000Z");
        assert.equal(duration, "3 mins 2 secs");

        duration = Utilities.calcDuration(startTime, "2016-07-16T14:18:27.000Z");
        assert.equal(duration, "2 secs");

        duration = Utilities.calcDuration(startTime, "2016-07-16T14:18:25.001Z");
        assert.equal(duration, "1 ms");

        duration = Utilities.calcDuration(startTime, "2016-07-16T16:18:25.000Z");
        assert.equal(duration, "2 hrs");

        duration = Utilities.calcDuration(startTime, "2016-07-16T14:19:25.000Z");
        assert.equal(duration, "1 min");
    });

    test("Same Time", () => {
        const duration = Utilities.calcDuration(startTime, startTime);
        assert.equal(duration, "0 ms");
    });
});
