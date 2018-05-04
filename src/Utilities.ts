// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";

/**
 * Class that holds utility functions for use in different classes
 */
export class Utilities {
    /**
     * Parses a Sarif Message object and returns the message in string format
     * @param message sarif message object to be parsed
     */
    public static parseSarifMessage(message: sarif.Message): string {
        let str;

        if (message !== undefined) {
            if (message.text !== undefined) {
                str = message.text;
                if (message.arguments !== undefined) {
                    for (let index = 0; index < message.arguments.length; index++) {
                        str = str.split("{" + index + "}").join(message.arguments[index]);
                    }
                }
            }
        }

        return str;
    }
}
