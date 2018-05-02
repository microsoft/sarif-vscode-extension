// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { CodeFlow, CodeFlowStep, ThreadFlow } from "./Interfaces";
import { Location } from "./Location";

/**
 * Class that Has functions for processing the Sarif result codeflows
 */
export class CodeFlows {

    public static async create(sarifCodeFlows: sarif.CodeFlow[]) {
        let codeFlows;
        if (sarifCodeFlows !== undefined && sarifCodeFlows.length !== 0) {
            codeFlows = [];
            for (let cFIndex = 0; cFIndex < sarifCodeFlows.length; cFIndex++) {
                await this.createCodeFlow(sarifCodeFlows[cFIndex], `${cFIndex}`).then((codeFlow: CodeFlow) => {
                    codeFlows.push(codeFlow);
                });
            }
        }

        return Promise.resolve(codeFlows);
    }

    public static async tryRemapCodeFlows(codeFlows: CodeFlow[], sarifCodeFlows: sarif.CodeFlow[]) {
        for (let cFIndex = 0; cFIndex < codeFlows.length; cFIndex++) {
            const codeFlow = codeFlows[cFIndex];
            for (let tFIndex = 0; tFIndex < codeFlow.threads.length; tFIndex++) {
                const thread = codeFlow.threads[tFIndex];
                for (let stepIndex = 0; stepIndex < thread.steps.length; stepIndex++) {
                    const step = thread.steps[stepIndex];
                    if (step.location !== null && step.location.mapped !== true) {
                        const sarifCFLoc = sarifCodeFlows[cFIndex].threadFlows[tFIndex].locations[stepIndex].location;
                        await Location.create(sarifCFLoc.physicalLocation).then((location: Location) => {
                            codeFlows[cFIndex].threads[tFIndex].steps[stepIndex].location = location;
                        });
                    }
                }
            }
        }
    }

    private static async createCodeFlow(sarifCF: sarif.CodeFlow, traversalId: string): Promise<CodeFlow> {
        const codeFlow: CodeFlow = {
            message: this.parseMessage(sarifCF.message),
            threads: [],
        };

        for (let tFIndex = 0; tFIndex < sarifCF.threadFlows.length; tFIndex++) {
            await this.createThreadFlow(sarifCF.threadFlows[tFIndex], `${traversalId}_${tFIndex}`).then(
                (threadFlow: ThreadFlow) => {
                    codeFlow.threads.push(threadFlow);
                });
        }

        return Promise.resolve(codeFlow);
    }

    private static async createThreadFlow(sarifTF: sarif.ThreadFlow, traversalId: string): Promise<ThreadFlow> {
        const threadFlow: ThreadFlow = {
            id: sarifTF.id,
            message: this.parseMessage(sarifTF.message),
            steps: [],
        };

        for (let stepIndex = 0; stepIndex < sarifTF.locations.length; stepIndex++) {
            await this.createCodeFlowStep(sarifTF.locations[stepIndex], sarifTF.locations[stepIndex + 1],
                `${traversalId}_${stepIndex}`).then((step: CodeFlowStep) => {
                    threadFlow.steps.push(step);
                });
        }

        return Promise.resolve(threadFlow);
    }

    private static async createCodeFlowStep(
        cfLoc: sarif.CodeFlowLocation,
        nextCFLoc: sarif.CodeFlowLocation,
        traversalPathId: string,
    ): Promise<CodeFlowStep> {

        let loc: Location;
        await Location.create(cfLoc.location.physicalLocation).then((location: Location) => {
            loc = location;
        });

        let isCallFlag = false;
        let isReturnFlag = false;
        if (nextCFLoc !== undefined) {
            if (cfLoc.nestingLevel < nextCFLoc.nestingLevel) {
                isCallFlag = true;
            } else if (cfLoc.nestingLevel > nextCFLoc.nestingLevel) {
                isReturnFlag = true;
            }
        }

        let messageText = this.parseMessage(cfLoc.location.message) || "";
        if (isReturnFlag) {
            messageText = "[Return Call]" + messageText;
        } else if (messageText === "") {
            messageText = "[No Description]";
        }

        const step: CodeFlowStep = {
            importance: cfLoc.importance || sarif.CodeFlowLocation.importance.important,
            isCall: isCallFlag,
            isReturn: isReturnFlag,
            location: loc,
            message: messageText,
            state: cfLoc.state,
            stepId: cfLoc.step,
            traversalId: traversalPathId,
        };

        return Promise.resolve(step);
    }

    private static parseMessage(message: sarif.Message): string {
        let str;

        if (message !== undefined) {
            if (message.text !== undefined) {
                str = message.text;
                if (message.arguments !== undefined) {
                    for (let index = 0; index < message.arguments.length; index++) {
                        str = str.replace("{" + index + "}", message.arguments[index]);
                    }
                }
            }
        }

        return str;
    }
}
