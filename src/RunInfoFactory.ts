// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { RunInfo } from "./common/Interfaces";
import { Utilities } from "./Utilities";

/**
 * Class that holds the run information processed from the Sarif run
 */
export class RunInfoFactory {

    /**
     * Processes the run passed in and creates a new RunInfo object with the information processed
     * @param run SARIF run object to process
     * @param sarifFileName path and file name of the sarif file this run is in
     */
    public static Create(run: sarif.Run, sarifFileName: string): RunInfo {
        const runInfo = {} as RunInfo;
        const tool = run.tool.driver;
        runInfo.toolName = tool.name;
        if (runInfo.toolFullName !== undefined) {
            runInfo.toolFullName = tool.fullName;
        } else if (tool.semanticVersion !== undefined) {
            runInfo.toolFullName = `${tool.name} ${tool.semanticVersion}`;
        } else {
            runInfo.toolFullName = tool.name;
        }

        if (run.invocations !== undefined && run.invocations[0] !== undefined) {
            const invocation = run.invocations[0];
            runInfo.cmdLine = invocation.commandLine;
            if (invocation.executableLocation !== undefined) {
                runInfo.toolFileName = invocation.executableLocation.uri;
            }

            if (invocation.workingDirectory !== undefined) {
                runInfo.workingDir = invocation.workingDirectory.uri;
            }

            runInfo.startUtc = invocation.startTimeUtc;
            runInfo.timeDuration = Utilities.calcDuration(invocation.startTimeUtc, invocation.endTimeUtc);
        }

        runInfo.additionalProperties = run.properties;
        runInfo.uriBaseIds = Utilities.expandBaseIds(run.originalUriBaseIds);

        runInfo.sarifFileFullPath = sarifFileName;
        runInfo.sarifFileName = Utilities.Path.basename(sarifFileName);

        if (run.automationDetails !== undefined && run.automationDetails.id !== undefined) {
            const splitId = run.automationDetails.id.split("/");
            const identifier = splitId.pop();
            if (identifier !== "") {
                runInfo.automationIdentifier = identifier;
            }

            const category = splitId.join("/");
            if (identifier !== "") {
                runInfo.automationCategory = category;
            }
        }

        return runInfo;
    }
}
