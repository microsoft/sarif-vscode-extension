// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { SarifClass } from "./SarifClass";

/**
 * Handles writing out the sarif type definitions file
 */
export class Writer {

    /**
     * Main method to output the SarifClass[] as a typescript file
     * @param classes Array of SarifClass objects to write to the file as typescript interfaces
     */
    public static outputTypeScript(classes: SarifClass[]) {
        let output = `// Type definitions for non-npm package Sarif 2.1
// Project: https://github.com/Microsoft/sarif-sdk
// Definitions by: Rusty Scrivens <https://github.com/rscrivens>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
// TypeScript Version: 2.4
`;
        for (const sarifClass of classes) {
            output += `
${Writer.createDocumentation(sarifClass.description, false)}
export interface ${sarifClass.name} {
${Writer.outputProperties(sarifClass)}
${Writer.outputAdditionalProps(sarifClass.additionalPropsType)}}`;

            output += Writer.outputEnums(sarifClass);
            output += `
`;
        }

        return output;
    }

    /**
     * Method to call to output a SarifClasses SarifProperties
     * @param sClass SarifClass that contains the SarifProperties
     */
    private static outputProperties(sClass: SarifClass): string {
        let output = ``;
        for (let j = 0; j < sClass.properties.length; j++) {
            const prop = sClass.properties[j];
            let optional = "";
            if (!prop.required) { optional = "?"; }
            output += `${Writer.createDocumentation(prop.description, true)}
`;

            if (prop.type === "object" && prop.additionalPropsType !== undefined && prop.properties === undefined) {
                output += `${prop.name}${optional}: { [key: string]: ${prop.additionalPropsType}};`;
            } else if (prop.type === "object" && prop.properties !== undefined && prop.properties.length > 0) {
                output += `${prop.name}${optional}: {`;
                for (const embeddedProperty of prop.properties) {
                    let embeddedOptional = "";
                    if (!embeddedProperty.required) { embeddedOptional = "?"; }
                    output += `
${Writer.createDocumentation(embeddedProperty.description, true)}
${embeddedProperty.name}${embeddedOptional}: ${embeddedProperty.type};
`;
                }

                output += `${Writer.outputAdditionalProps(prop.additionalPropsType)}};`;
            } else {
                output += `${prop.name}${optional}: ${prop.type};`;
            }

            if (j < sClass.properties.length - 1) {
                output += `

`;
            }
        }

        return output;
    }

    /**
     * Method to output Additional Properties
     * @param type Type of the additional property
     */
    private static outputAdditionalProps(type: string): string {
        if (type !== undefined) {
            return `
/**
 * Additional Properties
 */
[key: string]: ${type};`;
        }

        return "";
    }

    /**
     * Method to output the sarif classes Enums
     * @param sClass Sarif Class that contains the enums to output
     */
    private static outputEnums(sClass: SarifClass): string {
        let output = "";
        if (sClass.enums.length > 0) {
            let enums = "";
            for (let k = 0; k < sClass.enums.length; k++) {
                const sEnum = sClass.enums[k];
                let enumValues = "";
                for (let l = 0; l < sEnum.values.length; l++) {
                    /*let enumName = sEnum.values[l].split(/\.|\-/g).join("_");
                    if (!isNaN(parseInt(enumName[0]))) {
                        enumName = "_" + enumName;
                    }*/
                    enumValues += `
                    "${sEnum.values[l]}"`;
                    if (l < sEnum.values.length - 1) {
                        enumValues += ` |`;
                    }
                }
                enums += `
type ${sEnum.name} = ${enumValues};`;
                if (k < sClass.enums.length - 1) {
                    enums += `
`;
                }
            }

            output += `

export namespace ${sClass.name} {${enums}
}`;
        }
        return output;
    }

    /**
     * Method to generate the Documentation header of the classes and properties
     * @param message the message to put in the documentation
     * @param isMember if it's a member 4 spaces are added for indentation/formatting purposes
     */
    private static createDocumentation(message: string, isMember: boolean): string {
        let spaces = 0;
        if (isMember) {
            spaces = 4;
        }

        let output = `/**`;
        if (message === undefined || message === "") {
            message = "TBD";
        }

        const msgSplit = message.split(" ");

        let tempLine = " *";
        for (const msgPiece of msgSplit) {
            if ((spaces + tempLine.length + 1 /*space*/ + msgPiece.length) >= 120) {
                output += `
${tempLine}`;
                tempLine = " *";
            }

            tempLine += ` ${msgPiece}`;
        }

        output += `
${tempLine}
 */`;

        return output;
    }
}
