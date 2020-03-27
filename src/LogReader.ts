/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as path from "path";
import * as sarif from "sarif";

import { LocationFactory } from "./factories/LocationFactory";
import { ResultInfoFactory } from "./factories/ResultInfoFactory";
import { RunInfoFactory } from "./factories/RunInfoFactory";
import { SVDiagnosticFactory } from "./factories/SVDiagnosticFactory";

import { Disposable, Progress, ProgressLocation, ProgressOptions, TextDocument, Uri, window, workspace } from "vscode";
import { JsonMap, JsonMapping, ResultInfo, RunInfo, Location } from "./common/Interfaces";
import { FileConverter } from "./FileConverter";
import { ProgressHelper } from "./ProgressHelper";
import { ExplorerController } from "./ExplorerController";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";
import { CodeFlowFactory } from "./factories/CodeFlowFactory";

/**
 * Handles reading Sarif Logs, processes and adds the results to the collection to display in the problems window
 */
export class LogReader implements Disposable {
    private disposables: Disposable[] = [];

    /**
     * Helper method to check if the document provided is a sarif file
     * @param doc document to check if it's a sarif file
     */
    private static isSarifFile(doc: TextDocument): boolean {
        return (doc.languageId === "json" && doc.fileName.substring(doc.fileName.lastIndexOf(".")) === ".sarif");
    }

    public sarifJSONMapping: Map<string, JsonMapping>;

    private readonly jsonMap: JsonMap;

    public constructor(private readonly explorerController: ExplorerController) {
        this.sarifJSONMapping = new Map<string, JsonMapping>();
        this.jsonMap = require("json-source-map");

        // Listen for new sarif files to open or close
        this.disposables.push(workspace.onDidOpenTextDocument(this.onDocumentOpened.bind(this)));
        this.disposables.push(workspace.onDidCloseTextDocument(this.onDocumentClosed.bind(this)));
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * When a sarif document closes we need to clear all of the list of issues and reread the open sarif docs
     * Can't selectivly remove issues becuase the issues don't have a link back to the sarif file it came from
     * @param doc document that was closed
     */
    public onDocumentClosed(doc: TextDocument): void {
        if (LogReader.isSarifFile(doc)) {
            this.explorerController.diagnosticCollection.removeRuns(doc.fileName);
            return;
        }
    }

    /**
     * When a sarif document opens we read it and sync to the list of issues to add it to the problems panel
     * @param doc document that was opened
     */
    public async onDocumentOpened(doc: TextDocument): Promise<void> {
        if (LogReader.isSarifFile(doc)) {
            await this.read(doc, true);
        }
    }

    /**
     * Reads through all of the text documents open in the workspace, syncs the issues with problem panel after
     */
    public async readAll(): Promise<void> {
        // Get all the documents and read them
        const docs: readonly TextDocument[] = workspace.textDocuments;

        let needsSync: boolean = false;
        for (const doc of docs) {
            if (!needsSync && LogReader.isSarifFile(doc)) {
                needsSync = true;
            }
            await this.read(doc);
        }

        if (needsSync) {
            this.explorerController.diagnosticCollection.syncDiagnostics();
        }
    }

    /**
     * Reads a sarif file, processing the results and adding them to the issues collection for display in problems panel
     * @param doc text document to read
     * @param sync Optional flag to sync the issues after reading this file
     */
    public async read(doc: TextDocument, sync?: boolean): Promise<void> {
        if (LogReader.isSarifFile(doc)) {
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
                        docMapping = this.jsonMap.parse(doc.getText()) as JsonMapping;
                    } catch (error) {
                        await window.showErrorMessage(`Sarif Viewer:
                        Cannot display results for '${doc.fileName}' because: ${error.message}`);
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
                        // A run itself does not actually have an ID in SARIF.
                        // One is manufactured for the "run" by adding it to the diagnostic collection.
                        runInfo.id  = this.explorerController.diagnosticCollection.addRunInfoAndCalculateId(runInfo);

                        if (run.threadFlowLocations) {
                            CodeFlowFactory.mapThreadFlowLocationsFromRun(run.threadFlowLocations, runInfo.id);
                        }

                        if (run.artifacts) {
                            await ProgressHelper.Instance.setProgressReport("Mapping Files");
                            await this.explorerController.fileMapper.mapArtifacts(run.artifacts, runInfo.id);
                        }

                        if (run.results) {
                            await ProgressHelper.Instance.setProgressReport(`Loading ${run.results.length} Results`);
                            await this.readResults(run.results, run.tool, runInfo.id, doc.uri, runIndex);
                        }
                    }

                    if (sync) {
                        this.explorerController.diagnosticCollection.syncDiagnostics();
                    }

                    ProgressHelper.Instance.Progress = undefined;
                });
        }
    }

    /**
     * Reads the results from the run, adding a diagnostic for each result
     * @param results Array of results from the run
     * @param tool Tool from the run
     * @param runId Id of the processed run
     * @param docUri Uri of the sarif file
     * @param runIndex Index of the run in the sarif file
     */
    private async readResults(
        results: sarif.Result[], tool: sarif.Tool, runId: number, docUri: Uri, runIndex: number,
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
            const locationInSarifFile: Location | undefined = LocationFactory.mapToSarifFileResult(this, docUri, runIndex, resultIndex);

            const resultInfo: ResultInfo = await ResultInfoFactory.create(this.explorerController, sarifResult, runId, tool, resultIndex, locationInSarifFile);

            if (!resultInfo.assignedLocation || !resultInfo.assignedLocation.mapped) {
                resultInfo.assignedLocation = LocationFactory.mapToSarifFileLocation(this, docUri, runIndex, resultIndex);
            }

            const diagnostic: SarifViewerVsCodeDiagnostic  = SVDiagnosticFactory.create(this.explorerController.diagnosticCollection, resultInfo, sarifResult);
            this.explorerController.diagnosticCollection.add(diagnostic);
        }
    }
}
