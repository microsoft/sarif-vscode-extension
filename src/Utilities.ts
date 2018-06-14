// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { extensions } from "vscode";
import { Message } from "./Interfaces";
import { Location } from "./Location";

/**
 * Class that holds utility functions for use in different classes
 */
export class Utilities {
    public static iconsPath = extensions.getExtension("MS-SarifVSCode.sarif-viewer").extensionPath + "/out/resources/";

    public static get Document() {
        if (Utilities.document === undefined) {
            const jsdom = require("jsdom");
            Utilities.document = (new jsdom.JSDOM(``)).window.document;
        }
        return Utilities.document;
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
                let text = sarifMessage.text;
                if (sarifMessage.arguments !== undefined) {
                    for (let index = 0; index < sarifMessage.arguments.length; index++) {
                        text = text.split("{" + index + "}").join(sarifMessage.arguments[index]);
                    }
                }

                let messageText = text;
                const messageHTML = Utilities.Document.createElement("label") as HTMLLabelElement;
                // parse embedded locations
                let match = Utilities.embeddedRegEx.exec(messageText);
                if (locations !== undefined && match !== null) {
                    let textForHTML = messageText;
                    do {
                        const embeddedLink = match[1];
                        const linkText = match[2];
                        const linkId = parseInt(match[3], 10);

                        let location;
                        for (const loc of locations) {
                            if (loc !== undefined && loc.id === linkId) {
                                location = loc;
                                break;
                            }
                        }

                        if (location !== undefined) {
                            const uri = location.uri;

                            // Handle the Text version
                            messageText = messageText.replace(embeddedLink, `${linkText}(${uri.toString(true)})`);

                            // Handle the HTML version
                            const splitText = textForHTML.split(embeddedLink);
                            messageHTML.appendChild(/* Add the text before the link */
                                Utilities.Document.createTextNode(Utilities.unescapeBrackets(splitText[0])));
                            messageHTML.appendChild(/* Add the link */
                                Utilities.createSourceLink(location, Utilities.unescapeBrackets(linkText)));
                            splitText.splice(0, 1); /* remove the text before the link from the remaining text */
                            textForHTML = splitText.join(embeddedLink);
                        }

                        match = Utilities.embeddedRegEx.exec(messageText);
                    } while (match !== null);

                    if (textForHTML !== "") {
                        messageHTML.appendChild(Utilities.Document.createTextNode(textForHTML));
                    }
                } else {
                    messageHTML.textContent = text;
                }

                messageText = Utilities.unescapeBrackets(messageText);

                message = { text: messageText, html: messageHTML };
            }
        }

        return message;
    }

    /**
     * Creates a html link element that when clicked will open the source in the VSCode Editor
     * @param location The location object that represents where the link points to
     * @param linkText The text to display on the link
     */
    public static createSourceLink(location: Location, linkText: string): HTMLAnchorElement {
        const file = location.uri.toString(true);
        const linkElement = Utilities.Document.createElement("a") as HTMLAnchorElement;
        linkElement.setAttribute("title", file);
        linkElement.setAttribute("data-eCol", location.range.end.character.toString());
        linkElement.setAttribute("data-eLine", location.range.end.line.toString());
        linkElement.setAttribute("data-file", file);
        linkElement.setAttribute("data-sCol", location.range.start.character.toString());
        linkElement.setAttribute("data-sLine", location.range.start.line.toString());
        linkElement.href = "#0";
        linkElement.className = "sourcelink";
        linkElement.textContent = linkText;

        return linkElement;
    }

    private static document;
    private static embeddedRegEx = /[^\\](\[((?:\\\]|[^\]])+)\]\((\d+)\))/g;

    /**
     * Remove the escape '\' characters from before any '[' or ']' characters in the text
     * @param text text to remove the escape characters from
     */
    private static unescapeBrackets(text: string): string {
        return text.split("\\[").join("[").split("\\]").join("]");
    }
}
