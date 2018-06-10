// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Command } from "vscode";
import { ExplorerContentProvider } from "./ExplorerContentProvider";
import { CodeFlow, CodeFlowStep, CodeFlowStepId, ThreadFlow } from "./Interfaces";
import { Location } from "./Location";
import { Utilities } from "./Utilities";

/**
 * Class that has the functions for processing the Sarif result codeflows
 */
export class CodeFlows {
    /**
     * Processes the array of Sarif codeflow objects
     * @param sarifCodeFlows array of Sarif codeflow objects to be processed
     */
    public static async create(sarifCodeFlows: sarif.CodeFlow[]): Promise<CodeFlow[]> {
        let codeFlows;
        if (sarifCodeFlows !== undefined && sarifCodeFlows.length !== 0) {
            codeFlows = [];
            for (let cFIndex = 0; cFIndex < sarifCodeFlows.length; cFIndex++) {
                await CodeFlows.createCodeFlow(sarifCodeFlows[cFIndex], `${cFIndex}`).then((codeFlow: CodeFlow) => {
                    codeFlows.push(codeFlow);
                });
            }
        }

        return Promise.resolve(codeFlows);
    }

    /**
     * Parses a text version of the codeflow id
     * Returns a CodeFlowStepId object or undefined if there's no valid matching id (placeholder or bad formatting)
     * @param idText the codeflow id in text format ex: 1_1_2
     */
    public static parseCodeFlowId(idText: string): CodeFlowStepId {
        let codeFlowId: CodeFlowStepId;

        if (idText !== "-1") {
            const cFSelectionId = idText.split("_");
            if (cFSelectionId.length === 3) {
                codeFlowId = {
                    cFId: parseInt(cFSelectionId[0], 10),
                    stepId: parseInt(cFSelectionId[2], 10),
                    tFId: parseInt(cFSelectionId[1], 10),
                };
            }
        }

        return codeFlowId;
    }

    /**
     * Tries to remap any of the not mapped codeflow objects in the array of processed codeflow objects
     * @param codeFlows array of processed codeflow objects to try to remap
     * @param sarifCodeFlows Used if a codeflow needs to be remapped
     */
    public static async tryRemapCodeFlows(codeFlows: CodeFlow[], sarifCodeFlows: sarif.CodeFlow[]): Promise<void> {
        for (const cFKey of codeFlows.keys()) {
            const codeFlow = codeFlows[cFKey];
            for (const tFKey of codeFlow.threads.keys()) {
                const thread = codeFlow.threads[tFKey];
                for (const stepKey of thread.steps.keys()) {
                    const step = thread.steps[stepKey];
                    if (step.location !== null && step.location.mapped !== true) {
                        const sarifLoc = sarifCodeFlows[cFKey].threadFlows[tFKey].locations[stepKey].location;
                        await Location.create(sarifLoc.physicalLocation).then((location: Location) => {
                            codeFlows[cFKey].threads[tFKey].steps[stepKey].location = location;
                        });
                    }
                }
            }
        }
    }

    /**
     * Creates the CodeFlow object from the passed in sarif codeflow object
     * @param sarifCF the sarif codeflow object to be processed
     * @param traversalId The id based on the index in the codeflow array
     */
    private static async createCodeFlow(sarifCF: sarif.CodeFlow, traversalId: string): Promise<CodeFlow> {
        const codeFlow: CodeFlow = {
            message: undefined,
            threads: [],
        };

        if (sarifCF.message !== undefined) {
            codeFlow.message = Utilities.parseSarifMessage(sarifCF.message).text;
        }
        for (let tFIndex = 0; tFIndex < sarifCF.threadFlows.length; tFIndex++) {
            await CodeFlows.createThreadFlow(sarifCF.threadFlows[tFIndex], `${traversalId}_${tFIndex}`).then(
                (threadFlow: ThreadFlow) => {
                    codeFlow.threads.push(threadFlow);
                });
        }

        return Promise.resolve(codeFlow);
    }

    /**
     * Creates the ThreadFlow object from the passed in sarif threadflow object
     * @param sarifTF the sarif threadflow object to be processed
     * @param traversalId The id based on the index in the codeflow array and threadflow array(ex: "1_1")
     */
    private static async createThreadFlow(sarifTF: sarif.ThreadFlow, traversalId: string): Promise<ThreadFlow> {
        const threadFlow: ThreadFlow = {
            id: sarifTF.id,
            lvlsFirstStepIsNested: 0,
            message: undefined,
            steps: [],
        };

        if (sarifTF.message !== undefined) {
            threadFlow.message = Utilities.parseSarifMessage(sarifTF.message).text;
        }

        for (let stepIndex = 0; stepIndex < sarifTF.locations.length; stepIndex++) {
            await CodeFlows.createCodeFlowStep(sarifTF.locations[stepIndex], sarifTF.locations[stepIndex + 1],
                `${traversalId}_${stepIndex}`).then((step: CodeFlowStep) => {
                    threadFlow.steps.push(step);
                });
        }

        // additional processing once we have all of the steps processed
        let hasUndefinedNestingLevel = false;
        let hasZeroNestingLevel = false;
        for (const index of threadFlow.steps.keys()) {
            threadFlow.steps[index].beforeIcon = CodeFlows.getBeforeIcon(index, threadFlow);

            // flag if step has undefined or 0 nestingLevel values
            if (threadFlow.steps[index].nestingLevel === -1) {
                hasUndefinedNestingLevel = true;
            } else if (threadFlow.steps[index].nestingLevel === 0) {
                hasZeroNestingLevel = true;
            }
        }

        threadFlow.lvlsFirstStepIsNested = CodeFlows.getLevelsFirstStepIsNested(threadFlow.steps[0],
            hasUndefinedNestingLevel, hasZeroNestingLevel);

        return Promise.resolve(threadFlow);
    }

    /**
     * Creates the CodeFlowStep object from the passed in sarif CodeFlowLocation object
     * @param cFLoc the CodeFlowLocation object that needs to be processed
     * @param nextCFLoc the next CodeFlowLocation object, it's nesting level is used to determine if isCall or isReturn
     * @param traversalPathId The id based on the index in the codeflow, threadflow and locations arrays (ex: "0_2_1")
     */
    private static async createCodeFlowStep(
        cFLoc: sarif.CodeFlowLocation,
        nextCFLoc: sarif.CodeFlowLocation,
        traversalPathId: string,
    ): Promise<CodeFlowStep> {

        let loc: Location;
        await Location.create(cFLoc.location.physicalLocation).then((location: Location) => {
            loc = location;
        });

        let isParentFlag = false;
        let isLastChildFlag = false;
        if (nextCFLoc !== undefined) {
            if ((cFLoc.nestingLevel < nextCFLoc.nestingLevel) ||
                (cFLoc.nestingLevel === undefined && nextCFLoc.nestingLevel !== undefined)) {
                isParentFlag = true;
            } else if (cFLoc.nestingLevel > nextCFLoc.nestingLevel ||
                (cFLoc.nestingLevel !== undefined && nextCFLoc.nestingLevel === undefined)) {
                isLastChildFlag = true;
            }
        }

        const message = Utilities.parseSarifMessage(cFLoc.location.message);
        let messageText = "";
        if (message !== undefined) {
            messageText = message.text;
        }

        if (messageText === "") {
            if (isLastChildFlag) {
                messageText = "[return call]";
            } else {
                messageText = "[no description]";
            }
        }

        let messageWithStepText = messageText;
        if (cFLoc.step !== undefined) {
            messageWithStepText = `Step ${cFLoc.step}: ${messageWithStepText}`;
        }

        const command = {
            arguments: [{
                request: "CodeFlowTreeSelectionChange",
                treeid_step: traversalPathId,
            }],
            command: ExplorerContentProvider.ExplorerCallbackCommand,
            title: messageWithStepText,
        } as Command;

        let nestingLevelValue = cFLoc.nestingLevel;
        if (nestingLevelValue === undefined) {
            nestingLevelValue = -1;
        }

        const step: CodeFlowStep = {
            beforeIcon: undefined,
            codeLensCommand: command,
            importance: cFLoc.importance || sarif.CodeFlowLocation.importance.important,
            isLastChild: isLastChildFlag,
            isParent: isParentFlag,
            location: loc,
            message: messageText,
            messageWithStep: messageWithStepText,
            nestingLevel: nestingLevelValue,
            state: cFLoc.state,
            stepId: cFLoc.step,
            traversalId: traversalPathId,
        };

        return Promise.resolve(step);
    }

    /**
     * Figures out which beforeIcon to assign to this step, returns full path to icon or undefined if no icon
     * @param index Index of the step to determine the before icon of
     * @param threadFlow threadFlow that contains the step
     */
    private static getBeforeIcon(index: number, threadFlow: ThreadFlow): string {
        let iconName: string;
        const step = threadFlow.steps[index];
        if (step.isParent) {
            iconName = "call-no-return.svg";
            for (let nextIndex = index + 1; nextIndex < threadFlow.steps.length; nextIndex++) {
                if (threadFlow.steps[nextIndex].nestingLevel <= step.nestingLevel) {
                    iconName = "call-with-return.svg";
                    break;
                }
            }
        } else if (step.isLastChild) {
            iconName = "return-no-call.svg";
            if (step.nestingLevel !== -1) {
                for (let prevIndex = index - 1; prevIndex >= 0; prevIndex--) {
                    if (threadFlow.steps[prevIndex].nestingLevel < step.nestingLevel) {
                        iconName = "return-with-call.svg";
                        break;
                    }
                }
            }
        }

        if (iconName !== undefined) {
            iconName = Utilities.iconsPath + iconName;
        }

        return iconName;
    }

    /**
     * Calculates the amount of nesting the first step has
     * @param step the first step in the threadflow
     * @param hasUndefinedNL flag for if the thread has any steps that are nested level of 0
     * @param hasZeroNL flag for if the thread has any steps that are nested level of 0
     */
    private static getLevelsFirstStepIsNested(step: CodeFlowStep, hasUndefinedNL: boolean, hasZeroNL: boolean): number {
        const firstNestingLevel = step.nestingLevel;
        let lvlsFirstStepIsNested = 0;
        switch (firstNestingLevel) {
            case -1:
                break;
            case 0:
                if (hasUndefinedNL === true) {
                    lvlsFirstStepIsNested++;
                }
                break;
            default:
                if (hasUndefinedNL === true) {
                    lvlsFirstStepIsNested++;
                }
                if (hasZeroNL === true) {
                    lvlsFirstStepIsNested++;
                }
                lvlsFirstStepIsNested = lvlsFirstStepIsNested + (firstNestingLevel - 1);
                break;
        }

        return lvlsFirstStepIsNested;
    }
}
