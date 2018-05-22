// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Range } from "vscode";
import { Message } from "./Interfaces";
import { Location } from "./Location";

/**
 * Class that holds utility functions for use in different classes
 */
export class Utilities {
    /**
     * Parses a Sarif Message object and returns the message in string format
     * Supports Embedded links(requires locations) and placeholders
     * @param sarifMessage sarif message object to be parsed
     * @param locations only needed if your message supports embedded links
     */
    public static parseSarifMessage(sarifMessage: sarif.Message, locations?: Location[]): Message {
        if (Utilities.document === undefined) {
            const jsdom = require("jsdom");
            Utilities.document = (new jsdom.JSDOM(``)).window.document;
        }

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
                const messageHTML = Utilities.document.createElement("label") as HTMLLabelElement;
                // parse embedded locations
                let match = Utilities.embeddedRegEx.exec(messageText);
                if (locations !== undefined && match !== null) {
                    let textForHTML = messageText;
                    do {
                        const embeddedLink = match[1];
                        const linkText = match[2];
                        const linkId = parseInt(match[3], 10);

                        let linkRange: Range;
                        let link: string;
                        for (const location of locations) {
                            if (location !== undefined && location.id === linkId) {
                                linkRange = location.range;
                                link = location.uri.toString(true);
                                break;
                            }
                        }

                        const replacedText = linkText + "(" + link + ")";
                        messageText = messageText.replace(embeddedLink, replacedText);

                        const splitText = textForHTML.split(embeddedLink);
                        const preLinkText = Utilities.document.createTextNode(Utilities.unescapeBrackets(splitText[0]));
                        messageHTML.appendChild(preLinkText);
                        const linkElement = Utilities.document.createElement("a") as HTMLAnchorElement;
                        linkElement.setAttribute("title", link);
                        linkElement.setAttribute("data-file", link);
                        linkElement.setAttribute("data-line", linkRange.start.line.toString());
                        linkElement.setAttribute("data-col", linkRange.start.character.toString());
                        linkElement.href = "#0";
                        linkElement.className = "sourcelink";
                        linkElement.textContent = Utilities.unescapeBrackets(linkText);
                        messageHTML.appendChild(linkElement);
                        splitText.splice(0, 1); /* remove the preLinkText */
                        textForHTML = splitText.join(embeddedLink);

                        match = Utilities.embeddedRegEx.exec(messageText);
                    } while (match !== null);

                    if (textForHTML !== "") {
                        messageHTML.appendChild(Utilities.document.createTextNode(textForHTML));
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
