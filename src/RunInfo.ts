// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";

/**
 * Class that holds the run information processed from the Sarif run
 */
export class RunInfo {

    /**
     * Processes the run passed in and creates a new RunInfo object with the information processed
     * @param run SARIF run object to process
     */
    public static Create(run: sarif.Run) {
        const runinfo = new RunInfo();

        runinfo.toolName = run.tool.name;
        runinfo.toolFullName = run.tool.fullName;
        if (runinfo.toolFullName === undefined || runinfo.toolFullName === "") {
            runinfo.toolFullName = run.tool.name;
            if (run.tool.semanticVersion !== undefined) {
                runinfo.toolFullName = runinfo.toolFullName + " " + run.tool.semanticVersion;
            }
        }

        if (run.invocation) {
            runinfo.cmdLine = run.invocation.commandLine;
            runinfo.fileName = run.invocation.fileName;
            runinfo.workingDir = run.invocation.workingDirectory;
        }

        return runinfo;
    }

    public toolFullName: string;
    public toolName: string;
    public cmdLine: string;
    public fileName: string;
    public workingDir: string;
}
