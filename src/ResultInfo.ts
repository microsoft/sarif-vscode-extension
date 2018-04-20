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
     * @param rules dictonary of rules in the run this result came from
     */
    public static async create(result: sarif.Result, rules: { [key: string]: sarif.Rule }) {
        const resultInfo = new ResultInfo();

        await ResultInfo.parseLocations(result).then((locations) => {
            resultInfo.locations = locations;
            resultInfo.assignedLocation = resultInfo.locations[0];
        });

        resultInfo.message = result.message || "";

        let ruleKey: string;
        if (result.ruleKey !== undefined) {
            ruleKey = result.ruleKey;
        } else if (result.ruleId !== undefined) {
            ruleKey = result.ruleId;
        }

        // Parse the rule related info
        // Overwrites the message if a messageFormats is provided in the rule
        if (ruleKey !== undefined) {
            if (rules !== undefined && rules[ruleKey] !== undefined) {
                const rule: sarif.Rule = rules[ruleKey];
                resultInfo.ruleId = rule.id;
                resultInfo.message = ResultInfo.parseRuleBasedMessage(rule, result.formattedRuleMessage);

                if (rule.helpUri !== undefined) {
                    resultInfo.ruleHelpUri = rule.helpUri;
                }

                if (rule.name !== undefined) {
                    resultInfo.ruleName = rule.name;
                }

                resultInfo.ruleDefaultLevel = rule.defaultLevel || sarif.Rule.defaultLevel.warning;
            } else {
                resultInfo.ruleId = ruleKey;
            }
        }

        return resultInfo;
    }

    /**
     * Itterates through the locations in the result and creates ResultLocations for each
     * If a location can't be created, it adds a null value to the array
     * @param result result file with the locations that need to be created
     */
    public static async parseLocations(result: sarif.Result): Promise<ResultLocation[]> {
        const locations = [];

        if (result.locations !== undefined) {
            for (const location of result.locations) {
                const physicalLocation = location.resultFile || location.analysisTarget;

                if (physicalLocation !== undefined) {
                    await ResultLocation.create(physicalLocation,
                        result.snippet).then((resultLocation: ResultLocation) => {
                            locations.push(resultLocation);
                        }, (reason) => {
                            // Uri wasn't provided in the physical location
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
            if (formattedRuleMessage.arguments !== undefined) {
                for (let index = 0; index < formattedRuleMessage.arguments.length; index++) {
                    message = message.replace("{" + index + "}", formattedRuleMessage.arguments[index]);
                }
            }
        } else if (rule.fullDescription !== undefined) {
            message = rule.fullDescription;
        } else {
            message = rule.shortDescription;
        }

        return message;
    }

    public assignedLocation: ResultLocation;
    public locations: ResultLocation[];
    public message = "";
    public ruleHelpUri: string;
    public ruleId = "";
    public ruleName = "";
    public ruleDefaultLevel = sarif.Rule.defaultLevel.warning;
}
