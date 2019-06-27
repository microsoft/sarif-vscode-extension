// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { CodeFlows } from "./CodeFlows";
import {
    Attachment, CodeFlow, Fix, FixChange, FixFile, Frame, Location, ResultInfo, Stack, Stacks,
} from "./common/Interfaces";
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

        await ResultInfoFactory.parseStacks(result.stacks, runId).then((stacks: Stacks) => {
            resultInfo.stacks = stacks;
        });

        if (result.properties !== undefined) {
            resultInfo.additionalProperties = result.properties;
        }

        let ruleIndex: number;
        let ruleId: string;
        let extensionIndex: number;

        if (result.rule !== undefined) {
            ruleIndex = result.rule.index;
            ruleId = result.rule.id;
            if (result.rule.toolComponent !== undefined) {
                extensionIndex = result.rule.toolComponent.index;
            }
        }

        ruleIndex = ruleIndex || result.ruleIndex;
        resultInfo.ruleId = ruleId || result.ruleId;

        const allLocations = resultInfo.locations.concat(resultInfo.relatedLocs);

        // Parse the rule related info
        let ruleMessageString: string;
        if (ruleIndex !== undefined && tool !== undefined) {
            let ruleDescriptors: sarif.ReportingDescriptor[];
            if (extensionIndex === undefined) {
                ruleDescriptors = tool.driver.rules;
            } else {
                ruleDescriptors = tool.extensions[extensionIndex].rules;
            }

            if (ruleDescriptors !== undefined && ruleDescriptors[ruleIndex] !== undefined) {
                const rule: sarif.ReportingDescriptor = ruleDescriptors[ruleIndex];

                resultInfo.ruleHelpUri = rule.helpUri;
                resultInfo.ruleName = rule.name;
                resultInfo.ruleDescription = Utilities.parseSarifMessage(rule.fullDescription || rule.shortDescription,
                    allLocations);

                if (rule.id !== undefined) {
                    resultInfo.ruleId = rule.id;
                }

                if (rule.defaultConfiguration !== undefined) {
                    resultInfo.severityLevel = rule.defaultConfiguration.level;
                    resultInfo.rank = rule.defaultConfiguration.rank;
                }

                if (result.message !== undefined && rule.messageStrings !== undefined) {
                    const resultMsgId = result.message.id;
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
                await LocationFactory.create(sarifLocation, runId).then((location: Location) => {
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
                const attachmentLocation = {
                    physicalLocation: { artifactLocation: sarifAttachment.artifactLocation },
                } as sarif.Location;
                await LocationFactory.create(attachmentLocation, runId).then((loc: Location) => {
                    attachment.file = loc;
                });

                if (sarifAttachment.regions !== undefined) {
                    attachment.regionsOfInterest = [];
                    for (const sarifRegion of sarifAttachment.regions) {
                        const regionLocation = {
                            physicalLocation: {
                                artifactLocation: sarifAttachment.artifactLocation,
                                region: sarifRegion,
                            },
                        } as sarif.Location;

                        await LocationFactory.create(regionLocation, runId).then((location: Location) => {
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
                if (sarifFix.artifactChanges !== undefined) {
                    fix.files = [];
                    for (const sarifChange of sarifFix.artifactChanges) {
                        const fixFile = {} as FixFile;
                        const fixLocation = {
                            physicalLocation: { artifactLocation: sarifChange.artifactLocation },
                        } as sarif.Location;
                        await LocationFactory.create(fixLocation, runId).then((loc: Location) => {
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

    /**
     * Parses the sarif stacks objects and returns a Stacks obj
     * @param sarifStacks sarif stacks to parse
     * @param runId id of the run this result is from
     */
    private static async parseStacks(sarifStacks: sarif.Stack[], runId: number): Promise<Stacks> {
        let stacks: Stacks;

        if (sarifStacks !== undefined) {
            stacks = { columnsWithContent: [true], stacks: [] } as Stacks;
            for (const sarifStack of sarifStacks) {
                const stack = {} as Stack;
                stack.message = Utilities.parseSarifMessage(sarifStack.message);
                stack.frames = [];
                for (const sarifFrame of sarifStack.frames) {
                    const frame = {} as Frame;
                    frame.name = "";
                    if (sarifFrame.module !== undefined) {
                        frame.name += sarifFrame.module + "!";
                    }

                    const sFLoc = sarifFrame.location;
                    if (sFLoc !== undefined) {
                        frame.message = Utilities.parseSarifMessage(sFLoc.message);
                        await LocationFactory.create(sFLoc, runId).then((loc: Location) => {
                            frame.location = loc;
                        });

                        if (sFLoc.logicalLocations !== undefined && sFLoc.logicalLocations.length > 0) {
                            if (sFLoc.logicalLocations[0].fullyQualifiedName !== undefined) {
                                frame.name += sFLoc.logicalLocations[0].fullyQualifiedName;
                            } else {
                                frame.name += sFLoc.logicalLocations[0].name;
                            }
                        }
                    }

                    frame.parameters = sarifFrame.parameters || [];
                    frame.threadId = sarifFrame.threadId;
                    stacks.columnsWithContent = this.checkFrameContent(frame, stacks.columnsWithContent);
                    stack.frames.push(frame);
                }

                stacks.stacks.push(stack);
            }
        }

        return stacks;
    }

    /**
     * checks if frame has content for each column, if it does then sets the hascontent flag to true
     * Provides a quick way for the sarif explorer to determine if it should not display a column
     * @param frame the stack frame to check for content
     * @param hasContent the current set of hasContent flags
     */
    private static checkFrameContent(frame: Frame, hasContent: boolean[]): boolean[] {
        if (hasContent[1] === false) {
            hasContent[1] = frame.message.text !== undefined && frame.message.text !== "";
        }
        if (hasContent[2] !== true) {
            hasContent[2] = frame.name !== undefined && frame.name !== "";
        }
        if (hasContent[3] !== true) {
            const range = frame.location.range;
            hasContent[3] = range !== undefined && range.start.line !== 0;
        }
        if (hasContent[4] !== true) {
            hasContent[4] = frame.location.fileName !== undefined && frame.location.fileName !== "";
        }
        if (hasContent[5] !== true) {
            hasContent[5] = frame.parameters !== undefined && frame.parameters.length !== 0;
        }
        if (hasContent[6] !== true) {
            hasContent[6] = frame.threadId !== undefined;
        }

        return hasContent;
    }
}
