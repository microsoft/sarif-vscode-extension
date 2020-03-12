/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import { CodeFlows } from "./CodeFlows";
import {
    Attachment, CodeFlow, Fix, FixChange, FixFile, Frame, Location, ResultInfo, Stack, Stacks, Message
} from "./common/Interfaces";
import { LocationFactory } from "./LocationFactory";
import { Utilities } from "./Utilities";
import * as vscode from "vscode";

/**
 * Class that holds the result information processed from the Sarif result
 */
export class ResultInfoFactory {

    /**
     * Processes the result passed in and creates a new ResultInfo object with the information processed
     * @param result sarif result object to be processed
     * @param runId id of the run this result is from
     * @param tool tool object that is used for the rules
     * @param id Identifier used to identify this result.
     * @param locationInSarifFile the location in the SARIF file
     */
    public static async create(result: sarif.Result, runId: number, tool: sarif.Tool, id: number, locationInSarifFile: Location): Promise<ResultInfo> {
        const locations: Location[] = await ResultInfoFactory.parseLocations(result.locations, runId);
        const relatedLocations: Location[] = await ResultInfoFactory.parseLocations(result.relatedLocations, runId);
        const attachments: Attachment[] = await ResultInfoFactory.parseAttachments(result.attachments, runId);
        const fixes: Fix[] = await ResultInfoFactory.parseFixes(result.fixes, runId);
        const codeFlows: CodeFlow[] = await CodeFlows.create(result.codeFlows, runId);

        const stacks: Stacks = await ResultInfoFactory.parseStacks(result.stacks, runId);

        let ruleIndex: number | undefined;
        let ruleId: string | undefined;
        let extensionIndex: number | undefined;
        let helpUri: string | undefined;
        let ruleName: string | undefined;
        let ruleDescription: Message | undefined;
        let severityLevel: sarif.ReportingConfiguration.level | undefined;
        let ruleRank: number | undefined;
        let ruleMessage: string | undefined;

        if (result.rule) {
            ruleIndex = result.rule.index;
            ruleId = result.rule.id;
            if (result.rule.toolComponent) {
                extensionIndex = result.rule.toolComponent.index;
            }
        }

        ruleIndex = ruleIndex || result.ruleIndex;
        ruleId = ruleId || result.ruleId;

        const allLocations: Location[] = locations.concat(relatedLocations);

        // Parse the rule related info
        if (ruleIndex && tool) {
            let ruleDescriptors: sarif.ReportingDescriptor[] | undefined;
            if (!extensionIndex) {
                ruleDescriptors = tool.driver.rules;
            } else if (tool.extensions) {
                ruleDescriptors = tool.extensions[extensionIndex].rules;
            }

            if (ruleDescriptors && ruleDescriptors[ruleIndex]) {
                const rule: sarif.ReportingDescriptor = ruleDescriptors[ruleIndex];

                helpUri = rule.helpUri;
                ruleName = rule.name;
                ruleDescription = Utilities.parseSarifMessage(rule.fullDescription || rule.shortDescription,
                    allLocations);

                ruleId = rule.id || ruleId;

                if (rule.defaultConfiguration) {
                    severityLevel = rule.defaultConfiguration.level;
                    ruleRank = rule.defaultConfiguration.rank;
                }

                if (result.message  && rule.messageStrings) {
                    const resultMsgId: string | undefined = result.message.id;
                    if (resultMsgId && rule.messageStrings) {
                        const sarifMessageString: sarif.MultiformatMessageString = rule.messageStrings[resultMsgId];
                        ruleMessage = sarifMessageString.text;
                    }
                }
            }
        }

        const resultMessage: sarif.Message = {
            text: ruleMessage || "No Message Provided"
        };

        return {
            id: id,
            locationInSarifFile: locationInSarifFile,
            runId: runId,
            baselineState: result.baselineState,
            locations: locations,
            assignedLocation: locations.length > 0 ? locations[0] : undefined,
            codeFlows: codeFlows,
            stacks: stacks,
            attachments: attachments,
            fixes: fixes,
            relatedLocs: relatedLocations,
            additionalProperties: result.properties,
            ruleHelpUri: helpUri,
            ruleName: ruleName,
            ruleDescription: ruleDescription,
            rank: result.rank || ruleRank,
            ruleId: ruleId,
            severityLevel: severityLevel || "warning",
            message: Utilities.parseSarifMessage(resultMessage, allLocations),
            kind: result.kind || "fail",
        };
    }

    /**
     * Iterates through the sarif locations and creates Locations for each
     * Sets undefined placeholders in the returned array for those that can't be mapped
     * @param sarifLocations sarif locations that need to be processed
     * @param runId id of the run this result is from
     */
    public static async parseLocations(sarifLocations: sarif.Location[] | undefined, runId: number): Promise<Location[]> {
        const locations: Location[] = [];

        if (sarifLocations) {
            for (const sarifLocation of sarifLocations) {
                locations.push(await LocationFactory.create(sarifLocation, runId));
            }
        } else {
            // Default location if none is defined points to the location of the result in the SARIF file.
            locations.push({});
        }

        return locations;
    }

    /**
     * Parses the sarif attachment objects and returns and array of processed Attachments
     * @param sarifAttachments sarif attachments to parse
     * @param runId id of the run this result is from
     */
    private static async parseAttachments(sarifAttachments: sarif.Attachment[] | undefined, runId: number): Promise<Attachment[]> {
        if (!sarifAttachments) {
            return [];
        }

        const attachments: Attachment[] = [];

        for (const sarifAttachment of sarifAttachments) {
            const description: Message  = Utilities.parseSarifMessage(sarifAttachment.description);

            const attachmentFile: Location = await LocationFactory.create({
                physicalLocation: {
                    artifactLocation: sarifAttachment.artifactLocation
                }
            }, runId);

            const regionsOfInterest: Location[] = [];
            if (sarifAttachment.regions) {
                for (const sarifRegion of sarifAttachment.regions) {
                    regionsOfInterest.push(await LocationFactory.create({
                        physicalLocation: {
                            artifactLocation: sarifAttachment.artifactLocation,
                            region: sarifRegion,
                        },
                    }, runId));
                }
            }

            attachments.push({
                description: description,
                file: attachmentFile,
                regionsOfInterest: regionsOfInterest
            });
        }

        return attachments;
    }

    /**
     * Parses the sarif fixes objects and returns and array of processed Fixes
     * @param sarifFixes sarif fixes to parse
     * @param runId id of the run this result is from
     */
    private static async parseFixes(sarifFixes: sarif.Fix[] | undefined, runId: number): Promise<Fix[]> {
        if (!sarifFixes) {
            return [];
        }

        const fixes: Fix[] = [];

        for (const sarifFix of sarifFixes) {
            const fixFiles: FixFile[] = [];

            if (sarifFix.artifactChanges) {

                for (const sarifChange of sarifFix.artifactChanges) {
                    const fixLocation: Location = await LocationFactory.create({
                        physicalLocation: {
                            artifactLocation: sarifChange.artifactLocation
                        },
                    }, runId);

                    const fixChanges: FixChange[] = [];
                    if (sarifChange.replacements) {
                        for (const sarifReplacement of sarifChange.replacements) {
                            fixChanges.push({
                                delete: LocationFactory.parseRange(sarifReplacement.deletedRegion).range,
                                insert: sarifReplacement.insertedContent && sarifReplacement.insertedContent.text
                            });
                        }
                    }
                    fixFiles.push({
                        changes: fixChanges,
                        location: fixLocation
                    });
                }
            }

            fixes.push({
                description: Utilities.parseSarifMessage(sarifFix.description),
                files: fixFiles
            });
        }

        return fixes;
    }

    /**
     * Parses the sarif stacks objects and returns a Stacks obj
     * @param sarifStacks sarif stacks to parse
     * @param runId id of the run this result is from
     */
    private static async parseStacks(sarifStacks: sarif.Stack[] | undefined, runId: number): Promise<Stacks> {
        if (!sarifStacks) {
            return {
                columnsWithContent: [],
                stacks: []
            };
        }

        let columnsWithContent: boolean[] = [];
        const stacks: Stack[] = [];

        for (const sarifStack of sarifStacks) {
            const message: Message = Utilities.parseSarifMessage(sarifStack.message);
            const frames: Frame[] = [];

            for (const sarifFrame of sarifStack.frames) {
                if (!sarifFrame.location) {
                    // Consider logging a stack-frame with no location?
                    // How do we represent this in the UI?
                    continue;
                }

                const frameLocation: Location = await LocationFactory.create(sarifFrame.location, runId);

                const frameNameParts: string[] = [];

                if (sarifFrame.module) {
                    frameNameParts.push(sarifFrame.module + "!");
                }

                if (frameLocation.logicalLocations) {
                    frameNameParts.push(frameLocation.logicalLocations[0]);
                }

                const frame: Frame = {
                    parameters: sarifFrame.parameters || [],
                    threadId: sarifFrame.threadId,
                    message: Utilities.parseSarifMessage(frameLocation.message),
                    location: frameLocation,
                    name: frameNameParts.join()
                };

                columnsWithContent = this.checkFrameContent(frame, columnsWithContent);

                frames.push(frame);
            }

            stacks.push({
                frames: frames,
                message: message
            });
        }

        return {
            columnsWithContent: columnsWithContent,
            stacks: stacks
        };
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
            const range: vscode.Range | undefined = frame.location.range;
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
