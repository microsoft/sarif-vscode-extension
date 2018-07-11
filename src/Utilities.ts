// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { extensions, Uri } from "vscode";
import { Location, Message } from "./common/Interfaces";
import { sarif } from "./common/SARIFInterfaces";

/**
 * Class that holds utility functions for use in different classes
 */
export class Utilities {
    public static readonly iconsPath = extensions.getExtension("MS-SarifVSCode.sarif-viewer").extensionPath +
        "/resources/icons/";
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
     * This will convert the passed in uri into a common format
     * ex: file:///d:/test/ and d:\\test will return d:\test
     * @param uri path to a directory
     */
    public static getDisplayableRootpath(uri: Uri): string {
        if (uri.scheme === "file") {
            return uri.fsPath;
        } else {
            return Utilities.Path.normalize(uri.toString(true));
        }
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

    private static fs: any;
    private static os: any;
    private static path: any;
    private static embeddedRegEx = /(?:[^\\]|^)(\[((?:\\\]|[^\]])+)\]\((\d+)\))/g;

    /**
     * Remove the escape '\' characters from before any '[' or ']' characters in the text
     * @param text text to remove the escape characters from
     */
    private static unescapeBrackets(text: string): string {
        return text.split("\\[").join("[").split("\\]").join("]");
    }
}
