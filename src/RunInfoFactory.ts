// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { RunInfo } from "./common/Interfaces";
import { sarif } from "./common/SARIFInterfaces";
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
        const tool = run.tool;
        runInfo.toolName = tool.name;
        if (runInfo.toolFullName !== undefined) {
            runInfo.toolFullName = tool.fullName;
        } else if (run.tool.semanticVersion !== undefined) {
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
        }

        runInfo.additionalProperties = run.properties;
        runInfo.uriBaseIds = Utilities.expandBaseIds(run.originalUriBaseIds);

        runInfo.sarifFileFullPath = sarifFileName;
        runInfo.sarifFileName = Utilities.Path.basename(sarifFileName);
        return runInfo;
    }
}
