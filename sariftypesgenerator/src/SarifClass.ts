// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { JSONSchema4 } from "json-schema";
import { SarifEnum } from "./interfaces";
import { SarifProperty } from "./SarifProperty";

/**
 * Class to represent a Sarif class
 */
export class SarifClass {
    /**
     * Method to parse the sarif propertie
     * @param properties json properties of the class
     * @param namespace namespace of the class used for enums
     */
    public static parseProperties(properties: JSONSchema4, namespace: string): {
        props: SarifProperty[],
        enums: SarifEnum[],
    } {
        const returnObj = { props: new Array<SarifProperty>(), enums: new Array<SarifEnum>() };
        for (const propertyName in properties) {
            if (properties.hasOwnProperty(propertyName)) {
                if (propertyName !== "dependencies") {
                    const sarifProp = new SarifProperty(propertyName, properties[propertyName], namespace);
                    returnObj.props.push(sarifProp);
                    returnObj.enums = returnObj.enums.concat(sarifProp.enums);
                }
            }
        }

        return returnObj;
    }

    /**
     * Method to mark the required flag on any listed required properties
     * @param properties Array of sarifProperty objects to check if they should be required
     * @param requiredProps array of required properties
     */
    public static markRequiredProps(properties: SarifProperty[], requiredProps: boolean | string[]) {
        if (requiredProps !== undefined && typeof requiredProps !== "boolean") {
            for (const reqProp of requiredProps) {
                const index = properties.findIndex((prop: SarifProperty) => {
                    if (prop.name === reqProp) {
                        return true;
                    }
                });
                properties[index].required = true;
            }
        }
    }

    /**
     * Method that parses the type of the additional properties
     * @param additionalProperties additional properties to extract the type from
     */
    public static getAdditionalPropertiesType(additionalProperties: boolean | JSONSchema4): string {
        let type: string;

        if (additionalProperties !== undefined && additionalProperties !== false) {
            if (additionalProperties === true) {
                type = "any";
            } else {
                additionalProperties = additionalProperties as JSONSchema4;
                if (additionalProperties.type !== undefined) {
                    type = additionalProperties.type as string;
                } else if (additionalProperties.$ref !== undefined) {
                    const ref = additionalProperties.$ref;
                    type = SarifClass.upperCaseClassName(ref.substring(ref.lastIndexOf("/") + 1));
                }
            }

            console.log("   additional Properties type: " + type);
        }

        return type;
    }

    /**
     * Helper method to uppercase the classname in a format where the first letter is caps
     * @param classname the class name to format
     */
    public static upperCaseClassName(classname: string): string {
        return classname[0].toUpperCase() + classname.substring(1, classname.length);
    }

    public additionalPropsType: string;
    public description: string;
    public enums: SarifEnum[];
    public name: string;
    public properties: SarifProperty[];

    constructor(jsonClassName: string, jsonClass: JSONSchema4) {
        this.name = SarifClass.upperCaseClassName(jsonClassName);
        this.description = jsonClass.description;
        const propsAndEnums = SarifClass.parseProperties(jsonClass.properties, this.name);
        this.properties = propsAndEnums.props;
        this.enums = propsAndEnums.enums;

        this.additionalPropsType = SarifClass.getAdditionalPropertiesType(jsonClass.additionalProperties);
        SarifClass.markRequiredProps(this.properties, jsonClass.required);
    }
}
