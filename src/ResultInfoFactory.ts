// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { CodeFlows } from "./CodeFlows";
import { Attachment, CodeFlow, Fix, FixChange, FixFile, Location, ResultInfo } from "./common/Interfaces";
import { LocationFactory } from "./LocationFactory";
import { Utilities } from "./Utilities";

/**
 * Class that holds the result information processed from the Sarif result
 */
export class ResultInfoFactory {

    /**
     * Processes the result passed in and creates a new ResultInfo object with the information processed
     * @param result sarif result object to be processed
     * @param runId id of the run this result is from
     * @param tool tool object that is used for the rules
     */
    public static async create(result: sarif.Result, runId: number, tool: sarif.Tool): Promise<ResultInfo> {
        const resultInfo = {} as ResultInfo;

        resultInfo.runId = runId;

        await ResultInfoFactory.parseLocations(result.locations, runId).then((locations) => {
            resultInfo.locations = locations;
            resultInfo.assignedLocation = resultInfo.locations[0];
        });

        await ResultInfoFactory.parseLocations(result.relatedLocations, runId).then((locations) => {
            resultInfo.relatedLocs = locations;
        });

        await ResultInfoFactory.parseAttachments(result.attachments, runId).then((attachments: Attachment[]) => {
            if (attachments.length > 0) {
                resultInfo.attachments = attachments;
            }
        });

        await ResultInfoFactory.parseFixes(result.fixes, runId).then((fixes: Fix[]) => {
            if (fixes.length > 0) {
                resultInfo.fixes = fixes;
            }
        });

        await CodeFlows.create(result.codeFlows, runId).then((codeFlows: CodeFlow[]) => {
            resultInfo.codeFlows = codeFlows;
        });

        if (result.properties !== undefined) {
            resultInfo.additionalProperties = result.properties;
        }

        const ruleIndex = result.ruleIndex;
        resultInfo.ruleId = result.ruleId;
        const allLocations = resultInfo.locations.concat(resultInfo.relatedLocs);

        // Parse the rule related info
        let ruleMessageString: string;
        if (ruleIndex !== undefined && tool !== undefined) {
            const ruleDescriptors = tool.driver.ruleDescriptors;
            if (ruleDescriptors !== undefined && ruleDescriptors[ruleIndex] !== undefined) {
                const rule: sarif.ReportingDescriptor = ruleDescriptors[ruleIndex];

                if (rule.id !== undefined) {
                    resultInfo.ruleId = rule.id;
                }

                if (rule.helpUri !== undefined) {
                    resultInfo.ruleHelpUri = rule.helpUri;
                }

                if (rule.name !== undefined) {
                    resultInfo.ruleName = Utilities.parseSarifMessage(rule.name).text;
                }

                if (rule.defaultConfiguration !== undefined) {
                    resultInfo.severityLevel = rule.defaultConfiguration.level;
                    resultInfo.rank = rule.defaultConfiguration.rank;
                }

                resultInfo.ruleDescription = Utilities.parseSarifMessage(rule.fullDescription || rule.shortDescription,
                    allLocations);

                if (result.message !== undefined && rule.messageStrings !== undefined) {
                    const resultMsgId = result.message.messageId;
                    if (resultMsgId !== undefined && rule.messageStrings[resultMsgId] !== undefined) {
                        ruleMessageString = rule.messageStrings[resultMsgId].text;
                    }
                }
            }
        }

        resultInfo.baselineState = result.baselineState;
        resultInfo.severityLevel = result.level || resultInfo.severityLevel || "warning";
        resultInfo.kind = result.kind || resultInfo.kind || "fail";
        resultInfo.rank = result.rank || resultInfo.rank;

        if (result.message === undefined) {
            result.message = {};
        }

        if (result.message.text === undefined) {
            result.message.text = ruleMessageString || "No Message Provided";
        }

        resultInfo.message = Utilities.parseSarifMessage(result.message, allLocations);

        return resultInfo;
    }

    /**
     * Itterates through the sarif locations and creates Locations for each
     * Sets undefined placeholders in the returned array for those that can't be mapped
     * @param sarifLocations sarif locations that need to be procesed
     * @param runId id of the run this result is from
     */
    public static async parseLocations(sarifLocations: sarif.Location[], runId: number): Promise<Location[]> {
        const locations = [];

        if (sarifLocations !== undefined) {
            for (const sarifLocation of sarifLocations) {
                await LocationFactory.create(sarifLocation.physicalLocation, runId).then((location: Location) => {
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
     * @param runId id of the run this result is from
     */
    private static async parseAttachments(sarifAttachments: sarif.Attachment[], runId: number): Promise<Attachment[]> {
        const attachments: Attachment[] = [];

        if (sarifAttachments !== undefined) {
            for (const sarifAttachment of sarifAttachments) {
                const attachment = {} as Attachment;
                attachment.description = Utilities.parseSarifMessage(sarifAttachment.description);
                await LocationFactory.create({ artifactLocation: sarifAttachment.artifactLocation }, runId).then(
                    (loc: Location) => {
                        attachment.file = loc;
                    });

                if (sarifAttachment.regions !== undefined) {
                    attachment.regionsOfInterest = [];
                    for (const sarifRegion of sarifAttachment.regions) {
                        const physicalLocation = {
                            artifactLocation: sarifAttachment.artifactLocation,
                            region: sarifRegion,
                        } as sarif.PhysicalLocation;

                        await LocationFactory.create(physicalLocation, runId).then((location: Location) => {
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
     * Parses the sarif fixes objects and returns and array of processed Fixes
     * @param sarifFixes sarif fixes to parse
     * @param runId id of the run this result is from
     */
    private static async parseFixes(sarifFixes: sarif.Fix[], runId: number): Promise<Fix[]> {
        const fixes: Fix[] = [];

        if (sarifFixes !== undefined) {
            for (const sarifFix of sarifFixes) {
                const fix = {} as Fix;
                fix.description = Utilities.parseSarifMessage(sarifFix.description);
                if (sarifFix.changes !== undefined) {
                    fix.files = [];
                    for (const sarifChange of sarifFix.changes) {
                        const fixFile = {} as FixFile;
                        await LocationFactory.create({ artifactLocation: sarifChange.artifactLocation }, runId).then(
                            (loc: Location) => {
                                fixFile.location = loc;
                            });

                        if (sarifChange.replacements !== undefined) {
                            fixFile.changes = [];
                            for (const sarifReplacement of sarifChange.replacements) {
                                const fixChange = {} as FixChange;
                                if (sarifReplacement.insertedContent !== undefined) {
                                    fixChange.insert = sarifReplacement.insertedContent.text;
                                }
                                fixChange.delete = LocationFactory.parseRange(sarifReplacement.deletedRegion).range;
                                fixFile.changes.push(fixChange);
                            }
                        }
                        fix.files.push(fixFile);
                    }
                }
                fixes.push(fix);
            }
        }

        return fixes;
    }
}
