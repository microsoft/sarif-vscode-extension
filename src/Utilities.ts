// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Message } from "./Interfaces";
import { Location } from "./Location";

/**
 * Class that holds utility functions for use in different classes
 */
export class Utilities {
    /**
     * Parses a Sarif Message object and returns the message in string format
     * @param sarifMessage sarif message object to be parsed
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
                if (locations !== undefined) {
                    const matches = messageText.match(Utilities.embeddedRegEx);
                    for (const index of matches.keys()) {
                        const match = matches[index];
                        const linkText = match.split(/\[|\]/g);
                        const linkId = match.split(/\(|\)/g);
                        
                    }
                } else {
                    messageHTML.textContent = text;
                }

                message = { text: messageText, html: messageHTML };
            }
        }

        return message;
    }

    private static document;
    private static embeddedRegEx = /\[[^\\\]]+\]\(\d+\)/g;
}
