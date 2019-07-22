// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { JSONSchema4 } from "json-schema";
import { SarifEnum } from "./interfaces";
import { SarifClass } from "./SarifClass";

/**
 * Class to represent a sarif property
 */
export class SarifProperty {
    /**
     * Helper method to pull out the reference name from a reference string
     * @param reference reference string to pull the name from
     */
    private static getReferenceName(reference: string): string {
        const startIndex = reference.lastIndexOf("/") + 1;
        const refName = reference.substring(startIndex);
        return SarifClass.upperCaseClassName(refName);
    }

    public additionalPropsType: string;
    public description: string;
    public enums: SarifEnum[];
    public name: string;
    public properties: SarifProperty[];
    public required: boolean;
    public type: string;

    constructor(name: string, property: JSONSchema4, namespace: string) {
        this.name = name;
        this.description = property.description;
        this.enums = [];
        if (property.type !== undefined) {
            this.type = property.type as string;
            switch (property.type) {
                case "integer":
                    this.type = "number"; break;
                case "array":
                    let type = "any";
                    property.items = property.items as JSONSchema4;
                    if (property.items.$ref !== undefined) {
                        type = SarifProperty.getReferenceName(property.items.$ref);
                    } else if (property.items.type !== undefined) {
                        type = property.items.type as string;
                    } else if (property.items.enum !== undefined) {
                        this.enums.push({ name: this.name, values: property.items.enum } as SarifEnum);
                        type = namespace + "." + this.name;
                    }

                    if (type === "integer") {
                        type = "number";
                    }

                    this.type = type + "[]";
                    break;
                case "object":
                    console.log("Object type for: " + this.name);
                    this.additionalPropsType = SarifClass.getAdditionalPropertiesType(property.additionalProperties);

                    if (property.properties !== undefined) {

                        const propsAndEnums = SarifClass.parseProperties(property.properties, namespace);
                        this.properties = propsAndEnums.props;
                        this.enums = propsAndEnums.enums;
                        SarifClass.markRequiredProps(this.properties, property.required);
                        if (this.enums.length > 0) { console.log("embedded enums"); }
                    }
                    break;
            }
        } else if (property.$ref !== undefined) {
            this.type = SarifProperty.getReferenceName(property.$ref);
        } else if (property.enum !== undefined) {
            // need to push these enumsup to the parent class
            this.enums.push({ name: this.name, values: property.enum } as SarifEnum);
            this.type = namespace + "." + this.name;
        } else {
            console.error("unknown type ");
            // tslint:disable-next-line: no-debugger
            debugger;
        }
    }
}
