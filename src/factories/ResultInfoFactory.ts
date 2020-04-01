/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
import * as sarif from "sarif";
import { CodeFlowFactory } from  "./CodeFlowFactory";
import { LocationFactory } from "./LocationFactory";

import {
    Attachment, CodeFlow, Fix, FixChange, FixFile, Frame, Location, ResultInfo, Stack, Stacks, Message, StackColumnWithContent, RunInfo
} from "../common/Interfaces";
import { Utilities } from "../Utilities";
import { FileMapper } from "../FileMapper";

/**
 * Namespace that has the functions for processing (and transforming) the Sarif results (and runs)
 * a model used by the Web Panel..
 */
export namespace ResultInfoFactory {

    /**
     * Processes the result passed in and creates a new ResultInfo object with the information processed
     * @param fileMapper The file mapper used to map the URI locations to a valid local path.
     * @param result The original sarif result object to be processed.
     * @param tool tool object that is used for the rules
     * @param id Identifier used to identify this result.
     * @param locationInSarifFile the location in the SARIF file
     */
    export async function create(
        fileMappper: FileMapper,
        runInfo: RunInfo,
        result: sarif.Result,
        tool: sarif.Tool,
        id: number,
        locationInSarifFile?: Location): Promise<ResultInfo> {
        const locations: Location[] = await ResultInfoFactory.parseLocations(fileMappper, runInfo, result.locations);
        const relatedLocations: Location[] = await ResultInfoFactory.parseLocations(fileMappper, runInfo, result.relatedLocations);
        const attachments: Attachment[] = await parseAttachments(fileMappper, runInfo, result.attachments);
        const fixes: Fix[] = await parseFixes(fileMappper, runInfo, result.fixes);
        const codeFlows: CodeFlow[] = await CodeFlowFactory.create(fileMappper, runInfo, result.codeFlows);
        const stacks: Stacks = await parseStacks(fileMappper, runInfo, result.stacks);

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
        if (ruleIndex !== undefined  && tool) {
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
                ruleDescription = Utilities.parseSarifMessage(
                    rule.fullDescription || rule.shortDescription,
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

        let resultMessage: sarif.Message = {
            ...result.message
        };

        if (result.message.text === undefined ) {
            resultMessage = {
                ...resultMessage,
                text: ruleMessage || "No Message Provided"
            };
        }

        return {
            runInfo,
            id,
            locationInSarifFile,
            runId: runInfo.id,
            baselineState: result.baselineState || "new",
            locations,
            assignedLocation: locations.length > 0 ? locations[0] : undefined,
            codeFlows,
            stacks,
            attachments,
            fixes,
            relatedLocs: relatedLocations,
            additionalProperties: result.properties,
            ruleHelpUri: helpUri,
            ruleName,
            ruleDescription,
            rank: result.rank || ruleRank,
            ruleId,
            severityLevel: severityLevel || "warning",
            message: Utilities.parseSarifMessage(resultMessage, allLocations),
            kind: result.kind || "fail",
        };
    }

    /**
     * Iterates through the sarif locations and creates Locations for each
     * Sets undefined placeholders in the returned array for those that can't be mapped
     * @param fileMapper The file mapper used to map the URI locations to a valid local path.
     * @param runInfo The run the locations belongs to.
     * @param sarifLocations sarif locations that need to be processed
     */
    export async function parseLocations(fileMapper: FileMapper, runInfo: RunInfo, sarifLocations: sarif.Location[] | undefined): Promise<Location[]> {
        const locations: Location[] = [];

        if (sarifLocations) {
            for (const sarifLocation of sarifLocations) {
                locations.push(await LocationFactory.create(fileMapper, runInfo, sarifLocation));
            }
        } else {
            // Default location if none is defined points to the location of the result in the SARIF file.
            locations.push({
                range: new vscode.Range(0, 0, 0, 1),
                mapped: false,
                toJSON: () => {}
            });
        }

        return locations;
    }

    /**
     * Parses the sarif attachment objects and returns and array of processed Attachments
     * @param fileMapper The file mapper used to map the URI locations to a valid local path.
     * @param runInfo The run the attachments belongs to.
     * @param sarifAttachments sarif attachments to parse
     */
    async function  parseAttachments(fileMapper: FileMapper, runInfo: RunInfo, sarifAttachments: sarif.Attachment[] | undefined): Promise<Attachment[]> {
        if (!sarifAttachments) {
            return [];
        }

        const attachments: Attachment[] = [];

        for (const sarifAttachment of sarifAttachments) {
            const description: Message  = Utilities.parseSarifMessage(sarifAttachment.description);

            const attachmentFile: Location = await LocationFactory.create(fileMapper, runInfo, {
                physicalLocation: {
                    artifactLocation: sarifAttachment.artifactLocation
                }
            });

            const regionsOfInterest: Location[] = [];
            if (sarifAttachment.regions) {
                for (const sarifRegion of sarifAttachment.regions) {
                    regionsOfInterest.push(await LocationFactory.create(fileMapper, runInfo, {
                        physicalLocation: {
                            artifactLocation: sarifAttachment.artifactLocation,
                            region: sarifRegion,
                        },
                    }));
                }
            }

            attachments.push({
                description,
                file: attachmentFile,
                regionsOfInterest
            });
        }

        return attachments;
    }

    /**
     * Parses the sarif fixes objects and returns and array of processed Fixes
     * @param fileMapper The file mapper used to map the URI locations to a valid local path.
     * @param runInfo The run the fixes belongs to.
     * @param sarifFixes sarif fixes to parse
     */
    async function parseFixes(fileMapper: FileMapper, runInfo: RunInfo, sarifFixes: sarif.Fix[] | undefined): Promise<Fix[]> {
        if (!sarifFixes) {
            return [];
        }

        const fixes: Fix[] = [];

        for (const sarifFix of sarifFixes) {
            const fixFiles: FixFile[] = [];

            if (sarifFix.artifactChanges) {

                for (const sarifChange of sarifFix.artifactChanges) {
                    const fixLocation: Location = await LocationFactory.create(fileMapper, runInfo, {
                        physicalLocation: {
                            artifactLocation: sarifChange.artifactLocation
                        },
                    });

                    const fixChanges: FixChange[] = [];
                    if (sarifChange.replacements) {
                        for (const sarifReplacement of sarifChange.replacements) {
                            fixChanges.push({
                                delete: LocationFactory.parseRange(sarifReplacement.deletedRegion).range,
                                insert: sarifReplacement.insertedContent && sarifReplacement.insertedContent.text,
                                toJSON: Utilities.FixChangeToJson
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
     * @param fileMapper The file mapper used to map the URI locations to a valid local path.
     * @param runInfo The run the fixes belongs to.
     * @param sarifStacks sarif stacks to parse
     */
    async function parseStacks(fileMapper: FileMapper, runInfo: RunInfo, sarifStacks: sarif.Stack[] | undefined): Promise<Stacks> {
        let columnsWithContent: StackColumnWithContent = {
            filename: false,
            location: false,
            message: false,
            name: false,
            parameters: false,
            result: false,
            threadId: false
        };

        if (!sarifStacks) {
            return {
                columnsWithContent: columnsWithContent,
                stacks: []
            };
        }

        const stacks: Stack[] = [];
        columnsWithContent.result = true;

        for (const sarifStack of sarifStacks) {
            const message: Message = Utilities.parseSarifMessage(sarifStack.message);
            const frames: Frame[] = [];

            for (const sarifFrame of sarifStack.frames) {
                if (!sarifFrame.location) {
                    // Consider logging a stack-frame with no location?
                    // How do we represent this in the UI?
                    continue;
                }

                const frameLocation: Location = await LocationFactory.create(fileMapper, runInfo, sarifFrame.location);

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

                columnsWithContent = checkFrameContent(frame, columnsWithContent);

                frames.push(frame);
            }

            stacks.push({
                frames,
                message
            });
        }

        return {
            columnsWithContent,
            stacks
        };
    }

    /**
     * checks if frame has content for each column, if it does then sets the hascontent flag to true
     * Provides a quick way for the sarif explorer to determine if it should not display a column
     * @param frame the stack frame to check for content
     * @param hasContent the current set of hasContent flags
     */
    function checkFrameContent(frame: Frame, columnsWithContent: StackColumnWithContent): StackColumnWithContent {
        columnsWithContent.message = columnsWithContent.message && frame.message.text !== undefined && frame.message.text !== "";
        columnsWithContent.name = columnsWithContent.name && frame.name !== undefined && frame.name !== "";
        columnsWithContent.location = columnsWithContent.location && frame.location.range.start.line !== 0;
        columnsWithContent.filename = columnsWithContent.filename && frame.location.fileName !== undefined && frame.location.fileName !== "";
        columnsWithContent.parameters = columnsWithContent.parameters && frame.parameters.length !== 0;
        columnsWithContent.threadId = columnsWithContent.threadId && frame.threadId !== undefined;
        return columnsWithContent;
    }
}
