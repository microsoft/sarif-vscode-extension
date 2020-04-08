/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as path from "path";
import * as sarif from "sarif";

import { LocationFactory } from "./factories/LocationFactory";
import { ResultInfoFactory } from "./factories/ResultInfoFactory";
import { RunInfoFactory } from "./factories/RunInfoFactory";

import { Disposable, Progress, ProgressLocation, ProgressOptions, TextDocument, Uri, window, workspace } from "vscode";
import { JsonMap, JsonMapping, ResultInfo, RunInfo, Location } from "./common/Interfaces";
import { FileConverter } from "./FileConverter";
import { ProgressHelper } from "./ProgressHelper";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";
import { CodeFlowFactory } from "./factories/CodeFlowFactory";
import { Utilities } from "./Utilities";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

/**
 * Optinos used when readining\import SARIF files.
 */
export interface ReadOptions {
    /**
     * Specifies whether to synchronize the imported results with VSCode's diagnostics/problems pane.
     */
    synchronizeDiagnosticsCollection: boolean;
}

/**
 * Handles reading Sarif Logs, processes and adds the results to the collection to display in the problems window
 */
export class LogReader implements Disposable {
    private disposables: Disposable[] = [];

    /**
     * Contains a map between a parsed SARIF file (the key) to a JsonMapping object which contains
     * the result of the JSON parsing. This contains the actual SAIRF content and the "pointers" (which are like xpath's for XML)
     * to elements found in the JSON.
     */
    private readonly sarifJSONMapping: Map<string, JsonMapping> = new Map<string, JsonMapping>();

    /**
     * Creates an instance of the log reader that is responsible for parsing SARIF files.
     * @param diagnosticCollection The diagnostic collection the results will be read in to.
     */
    public constructor(private readonly diagnosticCollection: SVDiagnosticCollection) {
        // Listen for new sarif files to open or close
        this.disposables.push(workspace.onDidOpenTextDocument(this.onDocumentOpened.bind(this)));
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * When a sarif document opens we read it and sync to the list of issues to add it to the problems panel
     * @param doc document that was opened
     */
    public onDocumentOpened(doc: TextDocument): Promise<void> {
        return Utilities.isSarifFile(doc) ? this.read(doc, { synchronizeDiagnosticsCollection: true }) : Promise.resolve();
    }

    /**
     * Reads through all of the text documents open in the workspace, syncs the issues with problem panel after
     */
    public async readAll(): Promise<void> {
        // Keep a flag that indicates whether we need to send the collected issues to
        // VSCode's problems pane (i.e. synchronize diagnostics to the diagnostics collection)
        let synchronizeDiagnosticsCollection: boolean = false;

        // Spin through VSCode's documents and read any SARIF files that are opened.
        for (const sarifTextDocument of workspace.textDocuments.filter((doc) => Utilities.isSarifFile(doc))) {
            await this.read(sarifTextDocument, { synchronizeDiagnosticsCollection: false });
            synchronizeDiagnosticsCollection = true;
        }

        if (synchronizeDiagnosticsCollection) {
            this.diagnosticCollection.syncIssuesWithDiagnosticCollection();
        }
    }

    /**
     * Reads a sarif file, processing the results and adding them to the issues collection for display in problems panel
     * @param doc text document to read
     * @param options Optional flag to sync the issues after reading this file
     */
    public async read(doc: TextDocument, options: ReadOptions): Promise<void> {
        if (Utilities.isSarifFile(doc)) {
            const pOptions: ProgressOptions = {
                cancellable: false,
                location: ProgressLocation.Notification,
                title: "Processing " + path.basename(doc.fileName),
            };

            return window.withProgress(pOptions,
                async (progress: Progress<{ message?: string; increment?: number }>, cancleToken): Promise<void> => {
                    ProgressHelper.Instance.Progress = progress;
                    let runInfo: RunInfo;

                    let docMapping: JsonMapping;
                    await ProgressHelper.Instance.setProgressReport("Parsing Sarif file");
                    try {
                        const jsonMap: JsonMap = require("json-source-map");
                        docMapping = jsonMap.parse(doc.getText());
                    } catch (error) {
                        await window.showErrorMessage(`Sarif Viewer: Cannot display results for '${doc.fileName}' because: ${error.message}`);
                        return;
                    }

                    this.sarifJSONMapping.set(doc.uri.toString(), docMapping);
                    const log: sarif.Log = docMapping.data;

                    if (!log.$schema) {
                        await window.showErrorMessage(`Sarif Viewer:
                        Cannot display results for '${doc.fileName}' because the shema was not defined.`);
                        return;
                    }

                    if (await FileConverter.sarifUpgradeNeeded(log.version, log.$schema, doc)) {
                        return;
                    }

                    for (let runIndex: number = 0; runIndex < log.runs.length; runIndex++) {
                        const run: sarif.Run = log.runs[runIndex];
                        runInfo =  RunInfoFactory.create(run, doc.fileName);

                        this.diagnosticCollection.addRunInfo(runInfo);

                        if (run.threadFlowLocations) {
                            CodeFlowFactory.mapThreadFlowLocationsFromRun(runInfo, run.threadFlowLocations);
                        }

                        if (run.results) {
                            await ProgressHelper.Instance.setProgressReport(`Loading ${run.results.length} Results`);
                            await this.readResults(runInfo, run.results, run.tool, doc.uri, runIndex);
                        }
                    }

                    if (options.synchronizeDiagnosticsCollection) {
                        this.diagnosticCollection.syncIssuesWithDiagnosticCollection();
                    }

                    ProgressHelper.Instance.Progress = undefined;
                });
        }
    }

    /**
     * Reads the results from the run, adding a diagnostic for each result
     * @param results Array of results from the run
     * @param tool Tool from the run
     * @param docUri Uri of the sarif file
     * @param runIndex Index of the run in the sarif file
     */
    private async readResults(
        runInfo: RunInfo, results: sarif.Result[], tool: sarif.Tool, docUri: Uri, runIndex: number,
    ): Promise<void> {
        const showIncrement: boolean = results.length > 1000;
        let percent: number = 0;
        let interval: number;
        let nextIncrement: number;
        if (showIncrement) {
            interval = Math.floor(results.length / 10);
            nextIncrement = interval;
        } else {
            interval = 1;
            nextIncrement = 1;
        }

        for (let resultIndex: number = 0; resultIndex < results.length; resultIndex++) {
            if (showIncrement && resultIndex >= nextIncrement) {
                nextIncrement = nextIncrement + interval;
                percent = percent + 10;
                const progressMsg: string = `Loading ${results.length} Results: ${percent}% completed`;
                await ProgressHelper.Instance.setProgressReport(progressMsg, 10);
            }
            const sarifResult: sarif.Result = results[resultIndex];
            const resultLocationInSarifFile: Location | undefined = LocationFactory.mapToSarifFileResult(this.sarifJSONMapping, docUri, runIndex, resultIndex);

            const resultInfo: ResultInfo = await ResultInfoFactory.create(runInfo, sarifResult, tool, resultIndex, resultLocationInSarifFile);

            if (resultInfo.assignedLocation) {
                const diagnostic: SarifViewerVsCodeDiagnostic = new SarifViewerVsCodeDiagnostic(runInfo, resultInfo, sarifResult, resultInfo.assignedLocation.mappedToLocalPath ? resultInfo.assignedLocation : resultLocationInSarifFile);
                this.diagnosticCollection.add(diagnostic);
            }
        }
    }
}
