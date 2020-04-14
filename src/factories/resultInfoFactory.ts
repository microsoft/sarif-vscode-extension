/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */
import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as sarif from "sarif";
import { CodeFlowFactory } from "./codeFlowFactory";
import { LocationFactory } from "./locationFactory";

import {
    Attachment, CodeFlow, Fix, FixChange, FixFile, Frame, Location, ResultInfo, Stack, Stacks, Message, StackColumnWithContent, RunInfo
} from "../common/interfaces";
import { Utilities } from "../utilities";

/**
 * Namespace that has the functions for processing (and transforming) the Sarif results (and runs)
 * a model used by the Web Panel..
 */
export namespace ResultInfoFactory {

    /**
     * Processes the result passed in and creates a new ResultInfo object with the information processed
     * @param result The original sarif result object to be processed.
     * @param tool tool object that is used for the rules
     * @param id Identifier used to identify this result.
     * @param resultLocationInSarifFile the location in the SARIF file
     */
    export async function create(
        runInfo: RunInfo,
        result: sarif.Result,
        tool: sarif.Tool,
        id: number,
        resultLocationInSarifFile: Location): Promise<ResultInfo> {
        const locations: Location[] = await parseLocations(runInfo, result.locations);
        const relatedLocations: Location[] = await parseLocations(runInfo, result.relatedLocations);
        const attachments: Attachment[] = await parseAttachments(runInfo, result.attachments);
        const fixes: Fix[] = await parseFixes(runInfo, result.fixes);
        const codeFlows: CodeFlow[] = await CodeFlowFactory.create(runInfo, result.codeFlows);
        const stacks: Stacks = await parseStacks(runInfo, result.stacks);

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

        if (result.message.text === undefined) {
            resultMessage = {
                ...resultMessage,
                text: ruleMessage || localize('resultInfoFactory.noMessageProvided', "No Message Provided")

            };
        }

        return {
            runInfo,
            id,
            resultLocationInSarifFile,
            runId: runInfo.id,
            baselineState: result.baselineState || 'new',
            locations,

            // To ease other logic, don't assign assignedLocation if the location exist, but it has no URI.
            // Which, can actually happen. For example, when doing code-analysis on C++ using Microsoft's compiler, if there is an error
            // in reading the rule-set file, it produces an error result with that information, with a location without a vliad URI.
            assignedLocation: (locations.length > 0 && locations[0].uri) ? locations[0] : undefined,
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
            severityLevel: severityLevel || 'warning',
            message: Utilities.parseSarifMessage(resultMessage, allLocations),
            kind: result.kind || 'fail',
            rawResult: result
        };
    }

    /**
     * Iterates through the sarif locations and creates Locations for each
     * Sets undefined placeholders in the returned array for those that can't be mapped
     * @param runInfo The run the locations belongs to.
     * @param sarifLocations sarif locations that need to be processed
     */
    export async function parseLocations(runInfo: RunInfo, sarifLocations: sarif.Location[] | undefined): Promise<Location[]> {
        const locations: Location[] = [];

        if (sarifLocations) {
            for (const sarifLocation of sarifLocations) {
                locations.push(await LocationFactory.create(runInfo, sarifLocation));
            }
        }
        return locations;
    }

    /**
     * Parses the sarif attachment objects and returns and array of processed Attachments
     * @param runInfo The run the attachments belongs to.
     * @param sarifAttachments sarif attachments to parse
     */
    async function  parseAttachments(runInfo: RunInfo, sarifAttachments: sarif.Attachment[] | undefined): Promise<Attachment[]> {
        if (!sarifAttachments) {
            return [];
        }

        const attachments: Attachment[] = [];

        for (const sarifAttachment of sarifAttachments) {
            const description: Message  = Utilities.parseSarifMessage(sarifAttachment.description);

            const attachmentFile: Location = await LocationFactory.create(runInfo, {
                physicalLocation: {
                    artifactLocation: sarifAttachment.artifactLocation
                }
            });

            const regionsOfInterest: Location[] = [];
            if (sarifAttachment.regions) {
                for (const sarifRegion of sarifAttachment.regions) {
                    regionsOfInterest.push(await LocationFactory.create(runInfo, {
                        physicalLocation: {
                            artifactLocation: sarifAttachment.artifactLocation,
                            region: sarifRegion,
                        },
                    }));
                }
            }

            attachments.push({
                description,
                location: attachmentFile,
                regionsOfInterest
            });
        }

        return attachments;
    }

    /**
     * Parses the sarif fixes objects and returns and array of processed Fixes
     * @param runInfo The run the fixes belongs to.
     * @param sarifFixes sarif fixes to parse
     */
    async function parseFixes(runInfo: RunInfo, sarifFixes: sarif.Fix[] | undefined): Promise<Fix[]> {
        if (!sarifFixes) {
            return [];
        }

        const fixes: Fix[] = [];

        for (const sarifFix of sarifFixes) {
            const fixFiles: FixFile[] = [];

            if (sarifFix.artifactChanges) {

                for (const sarifChange of sarifFix.artifactChanges) {
                    const fixLocation: Location = await LocationFactory.create(runInfo, {
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
     * @param runInfo The run the fixes belongs to.
     * @param sarifStacks sarif stacks to parse
     */
    async function parseStacks(runInfo: RunInfo, sarifStacks: sarif.Stack[] | undefined): Promise<Stacks> {
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
                columnsWithContent,
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

                const frameLocation: Location = await LocationFactory.create(runInfo, sarifFrame.location);

                const frameNameParts: string[] = [];

                if (sarifFrame.module) {
                    frameNameParts.push(`${sarifFrame.module}!`);
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
        columnsWithContent.message = columnsWithContent.message && frame.message.text !== undefined && frame.message.text !== '';
        columnsWithContent.name = columnsWithContent.name && frame.name.length !== 0;
        columnsWithContent.location = columnsWithContent.location && frame.location.range.start.line !== 0;
        columnsWithContent.filename = columnsWithContent.filename && frame.location.fileName !== undefined && frame.location.fileName !== '';
        columnsWithContent.parameters = columnsWithContent.parameters && frame.parameters.length !== 0;
        columnsWithContent.threadId = columnsWithContent.threadId && frame.threadId !== undefined;
        return columnsWithContent;
    }
}
