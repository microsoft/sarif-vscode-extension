// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { ResultLocation } from "./ResultLocation";

/**
 * Class that holds the result information processed from the Sarif result
 */
export class ResultInfo {

    /**
     * Processes the result passed in and creates a new ResultInfo object with the information processed
     * @param result sarif result object to be processed
     * @param rules the set of results in the sarif file
     */
    public static async create(result: sarif.Result, rules: Map<string, sarif.Rule>) {
        const resultInfo = new ResultInfo();

        await ResultInfo.parseLocations(result).then((locations) => {
            resultInfo.locations = locations;
        });

        resultInfo.message = result.message || "";

        // Parse the rule related info
        // Overwrites the message if a messageFormats is provided in the rule
        if (result.ruleId !== undefined) {
            resultInfo.ruleId = result.ruleId;

            if (rules !== undefined && rules[resultInfo.ruleId] !== undefined) {
                const rule: sarif.Rule = rules[resultInfo.ruleId];

                resultInfo.message = ResultInfo.parseRuleBasedMessage(rule, result.formattedRuleMessage);

                if (rule.helpUri !== undefined) {
                    resultInfo.ruleHelpUri = rule.helpUri;
                }

                if (rule.name !== undefined) {
                    resultInfo.ruleName = rule.name;
                }

                resultInfo.ruleDefaultLevel = rule.defaultLevel || sarif.Rule.defaultLevel.warning;
            }
        }

        return resultInfo;
    }

    /**
     * Builds a messaged for the result based on the Rule's formated message
     * @param rule the rule associated with this result
     * @param formattedRuleMessage the formated messaged from the result
     */
    private static parseRuleBasedMessage(rule: sarif.Rule, formattedRuleMessage: sarif.FormattedRuleMessage): string {
        let message: string;
        if (formattedRuleMessage !== undefined &&
            rule.messageFormats !== undefined &&
            rule.messageFormats[formattedRuleMessage.formatId] !== undefined) {
            message = rule.messageFormats[formattedRuleMessage.formatId];
            for (let index = 0; index < formattedRuleMessage.arguments.length; index++) {
                message = message.replace("{" + index + "}",
                    formattedRuleMessage.arguments[index]);
            }
        } else if (rule.fullDescription !== undefined) {
            message = rule.fullDescription;
        } else {
            message = rule.shortDescription;
        }

        return message;
    }

    /**
     * Itterates through the locations in the result and ctreates ResultLocations for each
     * If a location can't be created it set it adds a null value to the array
     * @param result result file with the locations that need to be created
     */
    private static async parseLocations(result: sarif.Result): Promise<ResultLocation[]> {
        const locations = [];

        if (result.locations !== undefined) {
            for (const location of result.locations) {
                const physicalLocation = location.resultFile || location.analysisTarget;

                if (physicalLocation !== undefined) {
                    await ResultLocation.create(physicalLocation,
                        result.snippet).then((resultLocation: ResultLocation) => {
                            locations.push(resultLocation);
                        }, (reason) => {
                            locations.push(null);
                        });
                } else { // no physicalLocation to use
                    locations.push(null);
                }
            }
        } else {
            // Default location if none is defined points to the location of the result in the SARIF file.
            locations.push(null);
        }

        return Promise.resolve(locations);
    }

    public locations: ResultLocation[];
    public message = "";
    public ruleHelpUri = "";
    public ruleId = "";
    public ruleName = "";
    public ruleDefaultLevel = sarif.Rule.defaultLevel.warning;
}
