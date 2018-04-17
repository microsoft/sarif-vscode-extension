// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { commands, Disposable, TextDocument, window, workspace } from "vscode";
import { FileMapper } from "./FileMapper";
import { ResultInfo } from "./ResultInfo";
import { ResultLocation } from "./ResultLocation";
import { RunInfo } from "./RunInfo";
import { SVDiagnostic } from "./SVDiagnostic";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

/**
 * Handles reading Sarif Logs, processes and adds the results to the collection to display in the problems window
 */
export class LogReader {
    private static instance: LogReader;

    public sarifJSONMapping: Map<string, any>;

    private closeListenerDisposable: Disposable;
    private resultCollection: SVDiagnosticCollection;
    private openListenerDisposable: Disposable;
    private jsonMap;

    public static get Instance(): LogReader {
        if (LogReader.instance === undefined) {
            LogReader.instance = new LogReader();
        }

        return LogReader.instance;
    }

    private constructor() {
        this.resultCollection = new SVDiagnosticCollection();
        this.sarifJSONMapping = new Map<string, any>();

        this.jsonMap = require("json-source-map");

        FileMapper.Instance.OnMappingChanged(this.resultCollection.mappingChanged, this.resultCollection);

        // Listen for new sarif files to open or close
        this.openListenerDisposable = workspace.onDidOpenTextDocument(this.onDocumentOpened);
        this.closeListenerDisposable = workspace.onDidCloseTextDocument(this.onDocumentClosed);
    }

    /**
     * Clears the all of the issues that get displayed in the problems panel
     */
    public clearList(): void {
        this.resultCollection.clear();
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        this.resultCollection.dispose();
        this.openListenerDisposable.dispose();
        this.closeListenerDisposable.dispose();
    }

    /**
     * When a sarif document closes we need to clear all of the list of issues and reread the open sarif docs
     * Can't selectivly remove issues becuase the issues don't have a link back to the sarif file it came from
     * @param doc document that was closed
     */
    public onDocumentClosed(doc: TextDocument): void {
        if (doc.languageId === "sarif") {
            LogReader.Instance.clearList();
            LogReader.Instance.readAll();
        }
    }

    /**
     * When a sarif document opens we read it and sync to the list of issues to add it to the problems panel
     * @param doc document that was opened
     */
    public onDocumentOpened(doc: TextDocument): void {
        if (doc.languageId === "sarif") {
            LogReader.Instance.read(doc, true);
        }
    }

    /**
     * Reads through all of the text documents open in the workspace, syncs the issues with problem panel after
     */
    public async readAll(): Promise<void> {
        commands.executeCommand("workbench.action.problems.focus");

        // Get all the documents and read them
        const docs = workspace.textDocuments;

        for (const doc of docs) {
            await this.read(doc);
        }

        this.resultCollection.syncDiagnostics();
    }

    /**
     * Reads a sarif file, processing the results and adding them to the issues collection for display in problems panel
     * @param doc text document to read
     * @param sync Optional flag to sync the issues after reading this file
     */
    public async read(doc: TextDocument, sync?: boolean): Promise<void> {
        if (doc.languageId === "sarif") {
            let runInfo: RunInfo;
            let log: sarif.Log;

            try {
                const docMapping = this.jsonMap.parse(doc.getText());
                this.sarifJSONMapping.set(doc.uri.toString(), docMapping );
                log = docMapping.data;
            } catch (error) {
                window.showErrorMessage(`Cannot display results for '${doc.fileName}' because: ${error.message}`);
                return;
            }

            for (let runIndex = 0; runIndex < log.runs.length; runIndex++) {
                const run = log.runs[runIndex];
                runInfo = RunInfo.Create(run);
                await FileMapper.Instance.mapFiles(run.files);
                for (let resultIndex = 0; resultIndex < run.results.length; resultIndex++) {
                    await ResultInfo.create(run.results[resultIndex], run.rules).then((resultInfo: ResultInfo) => {
                        if (resultInfo.locations[0] === null) {
                            resultInfo.locations[0] = ResultLocation.mapToSarifFile(doc.uri, runIndex, resultIndex);
                        }

                        this.resultCollection.add(new SVDiagnostic(runInfo, resultInfo, run.results[resultIndex]));
                    });
                }
            }

            if (sync) {
                this.resultCollection.syncDiagnostics();
            }
        }
    }
}
