// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { CodeFlows } from "./CodeFlows";
import { Attachment, CodeFlow, Message } from "./Interfaces";
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

        await ResultInfo.parseAttachments(result.attachments).then((attachments: Attachment[]) => {
            if (attachments.length > 0) {
                resultInfo.attachments = attachments;
            }
        });

        await CodeFlows.create(result.codeFlows).then((codeFlows: CodeFlow[]) => {
            resultInfo.codeFlows = codeFlows;
        });

        if (result.properties !== undefined) {
            resultInfo.additionalProperties = result.properties;
        }

        const ruleKey = result.ruleId;
        resultInfo.ruleId = result.ruleId;
        const allLocations = resultInfo.locations.concat(resultInfo.relatedLocs);

        // Parse the rule related info
        let ruleMessageString: string;
        if (ruleKey !== undefined) {
            if (resources !== undefined && resources.rules !== undefined && resources.rules[ruleKey] !== undefined) {
                const rule: sarif.Rule = resources.rules[ruleKey];

                if (rule.id !== undefined) {
                    resultInfo.ruleId = rule.id;
                }

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

    /**
     * Parses the sarif attachment objects and returns and array of processed Attachments
     * @param sarifAttachments sarif attachments to parse
     */
    private static async parseAttachments(sarifAttachments: sarif.Attachment[]): Promise<Attachment[]> {
        const attachments: Attachment[] = [];

        if (sarifAttachments !== undefined) {
            for (const sarifAttachment of sarifAttachments) {
                const attachment = {} as Attachment;
                attachment.description = Utilities.parseSarifMessage(sarifAttachment.description);
                await Location.create({ fileLocation: sarifAttachment.fileLocation }).then((location: Location) => {
                    attachment.file = location;
                });

                if (sarifAttachment.regions !== undefined) {
                    attachment.regionsOfInterest = [];
                    for (const sarifRegion of sarifAttachment.regions) {
                        const physicalLocation = {
                            fileLocation: sarifAttachment.fileLocation,
                            region: sarifRegion,
                        } as sarif.PhysicalLocation;

                        await Location.create(physicalLocation).then((location: Location) => {
                            attachment.regionsOfInterest.push(location);
                        });
                    }
                }
                attachments.push(attachment);
            }
        }

        return attachments;
    }

    /**
     * Converts the rule default Level to sarif Level
     * @param defaultLevel default level to convert
     */
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
    public attachments: Attachment[];
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
