// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as fs from "fs";
import * as path from "path";
import * as sarif from "sarif";
import { extensions, Uri } from "vscode";
import { Location, Message } from "./common/Interfaces";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

/**
 * Class that holds utility functions for use in different classes
 */
export class Utilities {
    public static readonly configSection = "sarif-viewer";

    public static get IconsPath() {
        if (Utilities.iconsPath === undefined) {
            Utilities.iconsPath = extensions.getExtension("MS-SarifVSCode.sarif-viewer").extensionPath +
                "/resources/icons/";
        }
        return Utilities.iconsPath;
    }

    /**
     * Markdown-it object for parsing markdown text
     */
    public static get Md() {
        if (Utilities.md === undefined) {
            Utilities.md = require("markdown-it")();
        }
        return Utilities.md;
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
     * Calculates the duration between the start and end times
     * @param start string representing the start time in utc format
     * @param end string representing the end time in utc format
     */
    public static calcDuration(start: string, end: string): string {
        let duration = "";
        if (start !== undefined && end !== undefined) {
            const diff = new Date(end).getTime() - new Date(start).getTime();
            if (diff > 0) {
                const msDiff = diff % 1000;
                const sDiff = Math.floor((diff / 1000) % 60);
                const mDiff = Math.floor((diff / 60000) % 60);
                const hDiff = Math.floor(diff / 3600000);

                if (hDiff > 0) {
                    const label = (hDiff === 1) ? "hr" : "hrs";
                    duration = `${hDiff} ${label}`;
                }

                if (mDiff > 0) {
                    const label = (mDiff === 1) ? "min" : "mins";
                    duration = `${duration} ${mDiff} ${label}`;
                }

                if (sDiff > 0) {
                    const label = (sDiff === 1) ? "sec" : "secs";
                    duration = `${duration} ${sDiff} ${label}`;
                }

                if (msDiff > 0) {
                    duration = `${duration} ${msDiff} ms`;
                }

                duration = duration.trim();

            } else {
                duration = `0 ms`;
            }

        } else {
            duration = undefined;
        }

        return duration;
    }

    /**
     * Combines and returns the uri with it's uriBase, if uriBase is undefined just returns the original uri
     * @param uriPath uri path from sarif file to combine with the base
     * @param uriBase the uriBase as defined in the sarif file
     */
    public static combineUriWithUriBase(uriPath: string, uriBase: string): Uri {
        let combinedPath = uriPath;

        if (uriBase !== undefined && uriBase !== "") {
            combinedPath = this.joinPath(uriBase, uriPath);
        }

        let uri: Uri;
        if (combinedPath !== "") {
            try {
                uri = Uri.parse(combinedPath);
            } catch (e) {
                // URI malformed will happen if the combined path is something like %srcroot%/folder/file.ext
                // if it's malformed in the next if statement we force it to file schema
                if (e.message !== "URI malformed") { throw e; }
            }
        }

        if (uri === undefined || uri.scheme !== "file") {
            uri = Uri.file(combinedPath);
        }

        const fsPath = Utilities.getFsPathWithFragment(uri);

        return Uri.file(fsPath);
    }

    /**
     * Creates a readonly file at the path with the contents specified
     * If the file already exists method will delete that file and replace it with the new one
     * @param path path to create the file in
     * @param contents content to add to the file after created
     */
    public static createReadOnlyFile(directory: string, contents: string): void {
        if (fs.existsSync(directory)) {
            fs.unlinkSync(directory);
        }

        fs.writeFileSync(directory, contents, { mode: 0o444/*readonly*/ });
    }

    /**
     * expands out all of the nested based ids to get a flat dictionary of base ids
     * @param baseIds all of the base ids that need to be expanded out
     */
    public static expandBaseIds(baseIds: { [key: string]: sarif.ArtifactLocation }): { [key: string]: string } {
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
     * joins two paths adding a / if needed
     * @param start Start of path
     * @param end End of path
     */
    public static joinPath(start: string, end: string): string {
        let joined = start;

        if (joined !== "" && joined[joined.length - 1] !== "/") {
            joined = joined + "/";
        }

        if (end[0] === "/") {
            joined = joined + end.slice(1);
        } else {
            joined = joined + end;
        }

        return joined;
    }

    /**
     * Generates a folder path matching original path in the temp location and returns the path with the file included
     * @param filePath original file path, to recreate in the temp location
     * @param hashValue optional hash value to add to the path
     */
    public static generateTempPath(filePath: string, hashValue?: string): string {
        const pathObj = path.parse(filePath);
        let basePath: string = path.join(Utilities.SarifViewerTempDir, hashValue || "");
        let tempPath: string = Utilities.makeFileNameSafe(
            path.join(pathObj.dir.replace(pathObj.root, ""), path.win32.basename(filePath)));
        tempPath = tempPath.split("#").join(""); // remove the #s to not create a folder structure with fragments
        basePath = Utilities.createDirectoryInTemp(basePath);
        tempPath = path.posix.join(basePath, tempPath);

        return tempPath;
    }

    /**
     * This will remove illegal characters from a file name
     * Illegal characters include \/:*?"<>|
     * @param fileName file name to modify
     */
    public static makeFileNameSafe(fileName: string): string {
        return fileName.replace(/[/\\?%*:|"<>]/g, "-");
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
            return path.normalize(uri.toString(true));
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

        return path.normalize(uri.fsPath + fragment);
    }

    /**
     * gets the uriBase from this runs uriBaseIds, if no match: returns uriBaseId, if no uriBaseId: returns undefined
     * @param fileLocation File Location which contains the uriBaseId
     * @param runId The run's id to pull the runUriBaseIds from
     */
    public static getUriBase(fileLocation: sarif.ArtifactLocation, runId: number): string {
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
        let message = {} as Message;

        if (sarifMessage !== undefined) {
            let mdText = sarifMessage.markdown;
            let msgText = sarifMessage.text;

            // Insert result specific arguments
            if (sarifMessage.arguments !== undefined) {
                if (msgText !== undefined) {
                    for (let index = 0; index < sarifMessage.arguments.length; index++) {
                        msgText = msgText.split("{" + index + "}").join(sarifMessage.arguments[index]);
                    }
                }
                if (mdText !== undefined) {
                    for (let index = 0; index < sarifMessage.arguments.length; index++) {
                        mdText = mdText.split("{" + index + "}").join(sarifMessage.arguments[index]);
                    }
                }
            }

            if (mdText === undefined) {
                mdText = msgText;
            }

            if (mdText !== undefined) {
                mdText = Utilities.Md.render(mdText);
                mdText = Utilities.ReplaceLocationLinks(mdText, locations, true);
                mdText = Utilities.unescapeBrackets(mdText);
            }

            if (msgText !== undefined) {
                msgText = Utilities.Md.renderInline(msgText);
                msgText = Utilities.ReplaceLocationLinks(msgText, locations, false);
                msgText = msgText.replace(Utilities.linkRegEx, (match, p1, p2) => {
                    return `${p2}(${p1})`;
                });
                msgText = Utilities.unescapeBrackets(msgText);
                msgText = Utilities.Md.utils.unescapeAll(msgText);
            }

            message = { text: msgText, html: mdText };
        }

        return message;
    }

    /**
     * Handles cleaning up the Sarif Viewer temp directory used for temp files (embedded code, converted files, etc.)
     */
    public static removeSarifViewerTempDirectory(): void {
        const tempPath = path.join(Utilities.Os.tmpdir(), Utilities.SarifViewerTempDir);
        Utilities.removeDirectoryContents(tempPath);
        fs.rmdirSync(tempPath);
    }

    /**
     * Fixes up file schemed based paths to contain the proper casing for VSCode's URIs which are case sensitive.
     * @param uri The URI for which to fix the casing.
     */
    public static fixUriCasing(uri: Uri): Uri {
        // We can only support file-system scheme files.
        if (uri.scheme.toUpperCase() !== "FILE") {
            return uri;
        }

        let pathPartIndex: number = 0;
        const pathParts: string[] = uri.fsPath.split(path.sep);
        if (pathParts.length < 1) {
            return uri;
        }

        // We assume that the "root" drive is lower-cased which is "usually" the case.
        const fixedPathParts: string[] = [ pathParts[0].toLowerCase() + path.sep];

        while (pathPartIndex + 1 < pathParts.length) {
            const directoryToRead: string = path.join(...fixedPathParts);
            const directoryEntries: string[] = fs.readdirSync(directoryToRead);
            const fixedPathPart: string | undefined =
                directoryEntries.find((directoryEntry) =>
                    directoryEntry.toUpperCase() === pathParts[pathPartIndex + 1].toUpperCase());
            if (!fixedPathPart) {
                throw new Error(`Cannot find path part ${pathParts[pathPartIndex + 1]} of path ${uri.fsPath}`);
            }

            fixedPathParts.push(fixedPathPart);
            pathPartIndex++;
        }

        return Uri.file(path.join(...fixedPathParts));
    }

    private static md: markdownit;
    private static os: any;
    private static embeddedRegEx = /(<a href=)"(\d+)">/g;
    private static linkRegEx = /<a.*?href="(.*?)".*?>(.*?)<\/a>/g;
    private static iconsPath: string;
    private static readonly SarifViewerTempDir = "SarifViewerExtension";

    /**
     * Loops through the passed in path's directories and creates the directory structure
     * @param relativePath directory path that needs to be created in temp directory(including temp directory)
     */
    private static createDirectoryInTemp(relativePath: string): string {
        const directories = relativePath.split(path.sep);
        let createPath: string = Utilities.Os.tmpdir();

        for (const directory of directories) {
            createPath = path.join(createPath, directory);
            try {
                fs.mkdirSync(createPath);
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
    private static expandBaseId(id: string, baseIds: { [key: string]: sarif.ArtifactLocation }): string {
        let base = "";
        if (baseIds[id].uriBaseId !== undefined) {
            base = this.expandBaseId(baseIds[id].uriBaseId, baseIds);
        }

        return this.joinPath(base, baseIds[id].uri || id);
    }

    /**
     * Recursivly removes all of the contents in a directory, including subfolders
     * @param directory directory to remove all contents from
     */
    private static removeDirectoryContents(directory: string): void {
        const contents = fs.readdirSync(directory);
        for (const content of contents) {
            const contentPath = path.join(directory, content);
            if (fs.lstatSync(contentPath).isDirectory()) {
                this.removeDirectoryContents(contentPath);
                fs.rmdirSync(contentPath);
            } else {
                fs.unlinkSync(contentPath);
            }
        }
    }

    /**
     * Replaces links that are location links, that have a digit as the href value
     * @param text Text to parse through and replace location links with the usable link
     * @param locations array of locations to use in replacing the links
     * @param isMd if true the format replaced is as a markdown, if false it returns as if plain text
     */
    private static ReplaceLocationLinks(text: string, locations: Location[], isMd: boolean): string {
        if (locations === undefined) { return text; }

        return text.replace(Utilities.embeddedRegEx, (match, p1, id) => {
            const linkId = parseInt(id, 10);
            const location = locations.find((loc: Location, index: number, obj: Location[]) => {
                if (loc !== undefined && loc.id === linkId) {
                    return true;
                }
            });

            if (location !== undefined && location.uri !== undefined) {
                if (isMd) {
                    const className = `class="sourcelink"`;
                    const tooltip = `title="${location.uri.toString(true)}"`;
                    const data =
                        `data-file="${location.uri.toString(true)}" ` +
                        `data-sLine="${location.range.start.line}" ` +
                        `data-sCol="${location.range.start.character}" ` +
                        `data-eLine="${location.range.end.line}" ` +
                        `data-eCol="${location.range.end.character}"`;
                    const onClick = `onclick="explorerWebview.onSourceLinkClickedBind(event)"`;

                    return `${p1}"#0" ${className} ${data} ${tooltip} ${onClick}>`;
                } else {
                    return `${p1}"${location.uri.toString(true)}">`;
                }
            } else {
                return match;
            }
        });
    }

    /**
     * Remove the escape '\' characters from before any '[' or ']' characters in the text
     * @param text text to remove the escape characters from
     */
    private static unescapeBrackets(text: string): string {
        return text.split("\\[").join("[").split("\\]").join("]");
    }
}
