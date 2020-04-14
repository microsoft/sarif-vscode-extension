/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as path from "path";
import * as sarif from "sarif";
import * as fs from "fs";

import { LocationFactory } from "./factories/locationFactory";
import { ResultInfoFactory } from "./factories/resultInfoFactory";
import { RunInfoFactory } from "./factories/runInfoFactory";

import { Disposable, Progress, ProgressLocation, ProgressOptions, Uri, window } from "vscode";
import { JsonMap, JsonMapping, ResultInfo, RunInfo, Location } from "./common/interfaces";
import { FileConverter, UpgradeCheckInformation } from "./fileConverter";
import { ProgressHelper } from "./progressHelper";
import { CodeFlowFactory } from "./factories/codeFlowFactory";
import { Utilities } from "./utilities";

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
 * Contains the result of attempt to read a SARIF file.
 */
export interface LogReaderResult {
    /**
     * Contains the result of an upgrade check. If an upgraded is needed (or the schema cannot be)
     * determined, then the results will be empty.
     */
    upgradeCheckInformation: UpgradeCheckInformation;

    /**
     * On successful parse, contains the results parsed from the SARIF log.
     */
    parseResults: ParseResults[];

    /**
     * The sarif log read from the file.
     */
    sarifLog?: sarif.Log;
}

/**
 * The results from reading a SARIF file.
 */
export interface ParseResults {
    /**
     * Information about the run.
     */
    readonly runInfo: RunInfo;

    /**
     * The results from that run.
     */
    results: ResultInfo[];
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
     * For disposing on extension close
     */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * Reads a sarif file, processing the results and adding them to the issues collection for display in problems panel
     * @param doc text document to read
     * @param options Optional flag to sync the issues after reading this file
     */
    public async read(sarifFile: Uri): Promise<LogReaderResult> {
        const readResults: ParseResults[] = [];

        if (!sarifFile.isFile() && Utilities.isSarifFile(sarifFile.fsPath)) {
            throw new Error('The URI passed in is expected to be a SARIF log file');
        }

        const pOptions: ProgressOptions = {
            cancellable: false,
            location: ProgressLocation.Notification,
            title: localize('logReader.proecssingTitle', "Processing {0}", path.basename(sarifFile.fsPath)),
        };

        let upgradeCheckInformation: UpgradeCheckInformation = {
            upgradedNeeded: 'No'
        };

        await window.withProgress(pOptions, async (progress: Progress<{ message?: string; increment?: number }>, cancleToken): Promise<void> => {
            ProgressHelper.Instance.Progress = progress;
            let runInfo: RunInfo;

            let docMapping: JsonMapping;
            await ProgressHelper.Instance.setProgressReport(localize('logReader.processingSarifFile', "Parsing Sarif file"));
            try {
                const jsonBuffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
                    fs.readFile(sarifFile.fsPath, (err, data) => {
                        err ? reject(err) : resolve(data);
                    });
                });
                const jsonMap: JsonMap = require('json-source-map');
                docMapping = jsonMap.parse(jsonBuffer.toString());
            } catch (error) {
                await window.showErrorMessage(
                    localize(
                        "logReader.jsonFileReadingError", "Sarif Viewer: Cannot display results for '{0}' because: {1}",
                        sarifFile.fsPath, error.message));
                return;
            }

            this.sarifJSONMapping.set(sarifFile.toString(), docMapping);
            const log: sarif.Log = docMapping.data;

            upgradeCheckInformation = FileConverter.sarifLogNeedsUpgrade(log);

            if (upgradeCheckInformation.upgradedNeeded !== 'No') {
                return;
            }

            let resultInfos: ResultInfo[] = [];

            for (const [runIndex, sarifRun] of log.runs.entries()) {
                runInfo = RunInfoFactory.create(sarifRun, sarifFile.fsPath);

                if (sarifRun.threadFlowLocations) {
                    CodeFlowFactory.mapThreadFlowLocationsFromRun(runInfo, sarifRun.threadFlowLocations);
                }

                if (sarifRun.results) {
                    await ProgressHelper.Instance.setProgressReport(localize('logReader.loadingResults', "Loading {0} Results", sarifRun.results.length));
                    resultInfos = await this.readResults(runInfo, sarifRun.results, sarifRun.tool, sarifFile, runIndex);
                }

                readResults.push({
                    runInfo,
                    results: resultInfos
                });
            }

            ProgressHelper.Instance.Progress = undefined;
        });

        return {
            upgradeCheckInformation,
            parseResults: readResults
        };
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
    ): Promise<ResultInfo[]> {
        const resultInfos: ResultInfo[] = [];
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
                const progressMsg: string = localize('logReader.loadingResultsPercentage', "Loading {0} Results: {1}% completed", results.length, percent);
                await ProgressHelper.Instance.setProgressReport(progressMsg, 10);
            }
            const sarifResult: sarif.Result = results[resultIndex];
            const resultLocationInSarifFile: Location | undefined = LocationFactory.mapToSarifFileResult(this.sarifJSONMapping, docUri, runIndex, resultIndex);

            resultInfos.push(await ResultInfoFactory.create(runInfo, sarifResult, tool, resultIndex, resultLocationInSarifFile));
        }

        return resultInfos;
    }
}
