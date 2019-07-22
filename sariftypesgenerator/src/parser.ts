// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { JSONSchema4 } from "json-schema";
import { SarifClass } from "./SarifClass";
import { SarifProperty } from "./SarifProperty";

/**
 * Handles parsing the sarif json file
 */
export class Parser {

    /**
     * parses the json file and returns an array of SarifClass objects
     * @param schema json schema to parse
     */
    public static parseJSONDefinition(schema: JSONSchema4): SarifClass[] {
        let classes: SarifClass[] = [];

        for (const defName in schema.definitions) {
            if (schema.definitions.hasOwnProperty(defName)) {
                classes.push(new SarifClass(defName, schema.definitions[defName]));
            }
        }

        // Sort the classes and properties for more consistent output
        classes = classes.sort((a: SarifClass, b: SarifClass): number => {
            return a.name.localeCompare(b.name);
        });

        for (const sarifClass of classes) {
            sarifClass.properties = sarifClass.properties.sort((a: SarifProperty, b: SarifProperty): number => {
                if (a.name === "properties") {
                    return 1;
                } else if (b.name === "properties") {
                    return -1;
                }

                return a.name.localeCompare(b.name);
            });
        }

        // Lastly add the Log class and enum to the very top after the list of classes has been sorted
        const logClass = new SarifClass("Log", schema);
        classes.unshift(logClass);

        return classes;
    }
}
