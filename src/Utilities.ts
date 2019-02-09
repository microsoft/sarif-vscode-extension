// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { extensions, Uri } from "vscode";
import { Location, Message } from "./common/Interfaces";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

/**
 * Class that holds utility functions for use in different classes
 */
export class Utilities {
    public static readonly configSection = "sarif-viewer";

    /**
     * nodejs File System object
     */
    public static get Fs() {
        if (Utilities.fs === undefined) {
            Utilities.fs = require("fs");
        }
        return Utilities.fs;
    }

    public static get IconsPath() {
        if (Utilities.iconsPath === undefined) {
            Utilities.iconsPath = extensions.getExtension("MS-SarifVSCode.sarif-viewer").extensionPath +
                "/resources/icons/";
        }
        return Utilities.iconsPath;
    }

    /**
     * nodejs Operating System object
     */
    public static get Os() {
        if (Utilities.os === undefined) {
            Utilities.os = require("os");
        }
        return Utilities.os;
    }

    /**
     * nodejs Path object
     */
    public static get Path() {
        if (Utilities.path === undefined) {
            Utilities.path = require("path");
        }
        return Utilities.path;
    }

    /**
     * Combines and returns the uri with it's uriBase, if uriBase is undefined just returns the original uri
     * @param uriPath uri path from sarif file to combine with the base
     * @param uriBase the uriBase as defined in the sarif file
     */
    public static combineUriWithUriBase(uriPath: string, uriBase: string): Uri {
        let combinedPath = uriPath;

        if (uriBase !== undefined) {
            combinedPath = Utilities.Path.posix.join(uriBase, uriPath);
        }

        let uri: Uri;
        try {
            uri = Uri.parse(combinedPath);
        } catch (e) {
            // URI malformed will happen if the combined path is something like %srcroot%/folder/file.ext
            if (e.message !== "URI malformed") { throw e; }
        }

        if (uri === undefined || uri.scheme !== "file") {
            uri = Uri.file(combinedPath);
        }

        const path = Utilities.getFsPathWithFragment(uri);

        return Uri.file(path);
    }

    /**
     * Creates a readonly file at the path with the contents specified
     * If the file already exists method will delete that file and replace it with the new one
     * @param path path to create the file in
     * @param contents content to add to the file after created
     */
    public static createReadOnlyFile(path: string, contents: string): void {
        try {
            Utilities.Fs.unlinkSync(path);
        } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
        }

        Utilities.Fs.writeFileSync(path, contents, { mode: 0o444/*readonly*/ });
    }

    /**
     * expands out all of the nested based ids to get a flat dictionary of base ids
     * @param baseIds all of the base ids that need to be expanded out
     */
    public static expandBaseIds(baseIds: { [key: string]: sarif.FileLocation }): { [key: string]: string } {
        if (baseIds === undefined) {
            return undefined;
        }

        const expandedBaseIds: { [key: string]: string } = {};

        for (const id in baseIds) {
            if (baseIds.hasOwnProperty(id)) {
                expandedBaseIds[id] = this.expandBaseId(id, baseIds);
            }
        }

        return expandedBaseIds;
    }

    /**
     * Generates a folder path matching original path in the temp location and returns the path with the file included
     * @param filePath original file path, to recreate in the temp location
     * @param hashValue optional hash value to add to the path
     */
    public static generateTempPath(filePath: string, hashValue?: string): string {
        const pathObj = Utilities.Path.parse(filePath);
        let tempPath: string = Utilities.Path.posix.join(Utilities.SarifViewerTempDir, hashValue || "",
            pathObj.dir.replace(pathObj.root, ""));
        tempPath = tempPath.split("#").join(""); // remove the #s to not create a folder structure with fragments
        tempPath = Utilities.createDirectoryInTemp(tempPath);
        tempPath = Utilities.Path.posix.join(tempPath, Utilities.Path.win32.basename(filePath));

        return tempPath;
    }

    /**
     * This will convert the passed in uri into a common format
     * ex: file:///d:/test/ and d:\\test will return d:\test
     * @param uri path to a directory
     */
    public static getDisplayableRootpath(uri: Uri): string {
        if (uri.scheme === "file") {
            return Utilities.getFsPathWithFragment(uri);
        } else {
            return Utilities.Path.normalize(uri.toString(true));
        }
    }

    /**
     * Returns the fspath include the fragment if it exists
     * @param uri uri to pull the fspath and fragment from
     */
    public static getFsPathWithFragment(uri: Uri): string {
        let fragment = "";
        if (uri.fragment !== "") {
            fragment = "#" + uri.fragment;
        }

        return Utilities.Path.normalize(uri.fsPath + fragment);
    }

    /**
     * gets the uriBase from this runs uriBaseIds, if no match: returns uriBaseId, if no uriBaseId: returns undefined
     * @param fileLocation File Location which contains the uriBaseId
     * @param runId The run's id to pull the runUriBaseIds from
     */
    public static getUriBase(fileLocation: sarif.FileLocation, runId: number): string {
        let uriBase: string;
        if (fileLocation !== undefined && fileLocation.uriBaseId !== undefined) {
            const runUriBaseIds = SVDiagnosticCollection.Instance.getRunInfo(runId).uriBaseIds;
            if (runUriBaseIds !== undefined) {
                uriBase = runUriBaseIds[fileLocation.uriBaseId];
            }

            if (uriBase === undefined) {
                uriBase = fileLocation.uriBaseId;
            }
        }

        return uriBase;
    }

    /**
     * Parses a Sarif Message object and returns the message in string format
     * Supports Embedded links(requires locations) and placeholders
     * @param sarifMessage sarif message object to be parsed
     * @param locations only needed if your message supports embedded links
     */
    public static parseSarifMessage(sarifMessage: sarif.Message, locations?: Location[]): Message {
        let message: Message;

        if (sarifMessage !== undefined) {
            if (sarifMessage.text !== undefined) {
                let sarifText = sarifMessage.text;
                if (sarifMessage.arguments !== undefined) {
                    for (let index = 0; index < sarifMessage.arguments.length; index++) {
                        sarifText = sarifText.split("{" + index + "}").join(sarifMessage.arguments[index]);
                    }
                }

                let msgText = sarifText;
                const msgHTML = { text: sarifText, locations: new Array<{ text: string, loc: Location }>() };
                // parse embedded locations
                let match = Utilities.embeddedRegEx.exec(msgText);
                if (locations !== undefined && match !== null) {
                    do {
                        const embeddedLink = match[1];
                        const linkText = match[2];
                        const linkId = parseInt(match[3], 10);

                        let location: Location;
                        for (const loc of locations) {
                            if (loc !== undefined && loc.id === linkId) {
                                location = loc;
                                break;
                            }
                        }

                        if (location !== undefined) {
                            // Handle the Text version
                            msgText = msgText.replace(embeddedLink, `${linkText}(${location.uri.toString(true)})`);

                            // Handle the HTML version
                            msgHTML.text = msgHTML.text.replace(embeddedLink, `{(${msgHTML.locations.length})}`);
                            msgHTML.locations.push({ text: Utilities.unescapeBrackets(linkText), loc: location });
                        }

                        match = Utilities.embeddedRegEx.exec(msgText);
                    } while (match !== null);
                }

                msgText = Utilities.unescapeBrackets(msgText);
                msgHTML.text = Utilities.unescapeBrackets(msgHTML.text);
                message = { text: msgText, html: msgHTML };
            }
        }

        return message;
    }

    /**
     * Handles cleaning up the Sarif Viewer temp directory used for temp files (embedded code, converted files, etc.)
     */
    public static removeSarifViewerTempDirectory(): void {
        const path = Utilities.Path.join(Utilities.Os.tmpdir(), Utilities.SarifViewerTempDir);
        Utilities.removeDirectoryContents(path);
        Utilities.Fs.rmdirSync(path);
    }

    private static fs: any;
    private static os: any;
    private static path: any;
    private static embeddedRegEx = /(?:[^\\]|^)(\[((?:\\\]|[^\]])+)\]\((\d+)\))/g;
    private static iconsPath: string;
    private static readonly SarifViewerTempDir = "SarifViewerExtension";

    /**
     * Loops through the passed in path's directories and creates the directory structure
     * @param path directory path that needs to be created in temp directory(including temp directory)
     */
    private static createDirectoryInTemp(path: string): string {
        const directories = path.split(Utilities.Path.sep);
        let createPath: string = Utilities.Os.tmpdir();

        for (const directory of directories) {
            createPath = Utilities.Path.join(createPath, directory);
            try {
                Utilities.Fs.mkdirSync(createPath);
            } catch (error) {
                if (error.code !== "EEXIST") { throw error; }
            }
        }

        return createPath;
    }

    /**
     * Recursively expands all of the nested baseids of the base id
     * @param id baseId that needs to be expanded
     * @param baseIds all the base ids
     */
    private static expandBaseId(id: string, baseIds: { [key: string]: sarif.FileLocation }): string {
        let base = "";
        if (baseIds[id].uriBaseId !== undefined) {
            base = this.expandBaseId(baseIds[id].uriBaseId, baseIds);
        }

        return this.Path.posix.join(base, baseIds[id].uri);
    }

    /**
     * Recursivly removes all of the contents in a directory, including subfolders
     * @param path directory to remove all contents from
     */
    private static removeDirectoryContents(path: string): void {
        const contents = Utilities.Fs.readdirSync(path);
        for (const content of contents) {
            const contentPath = Utilities.Path.join(path, content);
            if (Utilities.Fs.lstatSync(contentPath).isDirectory()) {
                this.removeDirectoryContents(contentPath);
                Utilities.Fs.rmdirSync(contentPath);
            } else {
                Utilities.Fs.unlinkSync(contentPath);
            }
        }
    }

    /**
     * Remove the escape '\' characters from before any '[' or ']' characters in the text
     * @param text text to remove the escape characters from
     */
    private static unescapeBrackets(text: string): string {
        return text.split("\\[").join("[").split("\\]").join("]");
    }
}
