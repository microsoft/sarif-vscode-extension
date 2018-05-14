// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { CodeFlows } from "./CodeFlows";
import { CodeFlow, Message } from "./Interfaces";
import { Location } from "./Location";
import { Utilities } from "./Utilities";

/**
 * Class that holds the result information processed from the Sarif result
 */
export class ResultInfo {

    /**
     * Processes the result passed in and creates a new ResultInfo object with the information processed
     * @param result sarif result object to be processed
     * @param resouces resources object that is used for the rules
     */
    public static async create(result: sarif.Result, resources: sarif.Resources) {
        const resultInfo = new ResultInfo();

        await ResultInfo.parseLocations(result.locations).then((locations) => {
            resultInfo.locations = locations;
            resultInfo.assignedLocation = resultInfo.locations[0];
        });

        await ResultInfo.parseLocations(result.relatedLocations).then((locations) => {
            resultInfo.relatedLocs = locations;
        });

        await CodeFlows.create(result.codeFlows).then((codeFlows: CodeFlow[]) => {
            resultInfo.codeFlows = codeFlows;
        });

        if (result.properties !== undefined) {
            resultInfo.additionalProperties = result.properties;
        }

        let ruleKey: string;
        if (result.ruleKey !== undefined) {
            ruleKey = result.ruleKey;
        } else if (result.ruleId !== undefined) {
            ruleKey = result.ruleId;
        }

        const allLocations = resultInfo.locations.concat(resultInfo.relatedLocs);

        // Parse the rule related info
        let ruleMessageString: string;
        if (ruleKey !== undefined) {
            if (resources !== undefined && resources.rules !== undefined && resources.rules[ruleKey] !== undefined) {
                const rule: sarif.Rule = resources.rules[ruleKey];
                resultInfo.ruleId = rule.id;

                if (rule.helpLocation !== undefined) {
                    resultInfo.ruleHelpUri = rule.helpLocation;
                }

                if (rule.name !== undefined) {
                    resultInfo.ruleName = Utilities.parseSarifMessage(rule.name).text;
                }

                if (rule.configuration !== undefined && rule.configuration.defaultLevel !== undefined) {
                    resultInfo.severityLevel = ResultInfo.defaultLvlToLvlConverter(rule.configuration.defaultLevel);
                }

                resultInfo.ruleDescription = Utilities.parseSarifMessage(rule.fullDescription || rule.shortDescription,
                    allLocations);

                if (result.ruleMessageId !== undefined && rule.messageStrings[result.ruleMessageId] !== undefined) {
                    ruleMessageString = rule.messageStrings[result.ruleMessageId];
                }
            } else {
                resultInfo.ruleId = ruleKey;
            }
        }

        resultInfo.severityLevel = result.level || resultInfo.severityLevel || sarif.Result.level.warning;

        if (result.message !== undefined && result.message.text === undefined) {
            result.message.text = ruleMessageString;
        }

        resultInfo.message = Utilities.parseSarifMessage(result.message, allLocations);

        return resultInfo;
    }

    /**
     * Itterates through the sarif locations and creates Locations for each
     * Sets undefined placeholders in the returned array for those that can't be mapped
     * @param sarifLocations sarif locations that need to be procesed
     */
    public static async parseLocations(sarifLocations: sarif.Location[]): Promise<Location[]> {
        const locations = [];

        if (sarifLocations !== undefined) {
            for (const sarifLocation of sarifLocations) {
                await Location.create(sarifLocation.physicalLocation).then((location: Location) => {
                    locations.push(location);
                });
            }
        } else {
            // Default location if none is defined points to the location of the result in the SARIF file.
            locations.push(undefined);
        }

        return Promise.resolve(locations);
    }

    private static defaultLvlToLvlConverter(defaultLevel: sarif.RuleConfiguration.defaultLevel): sarif.Result.level {
        switch (defaultLevel) {
            case sarif.RuleConfiguration.defaultLevel.error:
                return sarif.Result.level.error;
            case sarif.RuleConfiguration.defaultLevel.warning:
                return sarif.Result.level.warning;
            case sarif.RuleConfiguration.defaultLevel.note:
                return sarif.Result.level.note;
            case sarif.RuleConfiguration.defaultLevel.open:
                return sarif.Result.level.open;
            default:
                return sarif.Result.level.warning;
        }
    }

    public additionalProperties: { [key: string]: string };
    public assignedLocation: Location;
    public codeFlows: CodeFlow[];
    public locations: Location[];
    public relatedLocs: Location[];
    public message: Message;
    public messageHTML: HTMLLabelElement;
    public ruleHelpUri: string;
    public ruleId = "";
    public ruleName = "";
    public ruleDescription: Message;
    public severityLevel: sarif.Result.level;
}
