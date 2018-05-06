// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { CodeFlows } from "./CodeFlows";
import { CodeFlow } from "./Interfaces";
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
                    resultInfo.ruleName = Utilities.parseSarifMessage(rule.name);
                }

                if (rule.configuration !== undefined && rule.configuration.defaultLevel !== undefined) {
                    resultInfo.severityLevel = rule.configuration.defaultLevel;
                }

                resultInfo.ruleDescription = Utilities.parseSarifMessage(rule.fullDescription || rule.shortDescription);

                if (result.ruleMessageId !== undefined && rule.messageStrings[result.ruleMessageId] !== undefined) {
                    ruleMessageString = rule.messageStrings[result.ruleMessageId];
                }
            } else {
                resultInfo.ruleId = ruleKey;
            }
        }

        if (result.message !== undefined && result.message.text === undefined) {
            result.message.text = ruleMessageString;
        }

        resultInfo.message = Utilities.parseSarifMessage(result.message);

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

    public additionalProperties: { [key: string]: string };
    public assignedLocation: Location;
    public codeFlows: CodeFlow[];
    public locations: Location[];
    public relatedLocs: Location[];
    public message = "";
    public ruleHelpUri: string;
    public ruleId = "";
    public ruleName = "";
    public ruleDescription = "";
    public severityLevel = sarif.RuleConfiguration.defaultLevel.warning;
}
