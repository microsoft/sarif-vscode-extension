/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, languages, Range } from "vscode";
import { RunInfo, SarifViewerDiagnostic } from "./common/Interfaces";
import { ExplorerController } from "./ExplorerController";
import { ResultsListController } from "./ResultsListController";
import { SVDiagnosticFactory } from "./SVDiagnosticFactory";
import { Utilities } from "./Utilities";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";

/**
 * Manager for the Diagnostic Collection contianing the sarif result diagnostics
 * Allows us to control which diagnostics we send to the Problems panel, so we can show a custom message on max entries
 * And lets us easily try to map those that weren't mapped previously
 */
export class SVDiagnosticCollection {
    private static MaxDiagCollectionSize: number;

    private static instance: SVDiagnosticCollection;

    private diagnosticCollection: DiagnosticCollection;
    private issuesCollection: Map<string, SarifViewerVsCodeDiagnostic[]>;
    private runInfoCollection: RunInfo[];
    private unmappedIssuesCollection: Map<string, SarifViewerVsCodeDiagnostic[]>;

    public static get Instance(): SVDiagnosticCollection {
        return SVDiagnosticCollection.instance || (SVDiagnosticCollection.instance = new SVDiagnosticCollection());
    }

    private constructor() {
        this.diagnosticCollection = languages.createDiagnosticCollection(SVDiagnosticCollection.name);
        // @ts-ignore: _maxDiagnosticsPerFile does exist on the DiagnosticCollection object
        SVDiagnosticCollection.MaxDiagCollectionSize = this.diagnosticCollection._maxDiagnosticsPerFile - 1;
        this.issuesCollection = new Map<string, SarifViewerVsCodeDiagnostic[]>();
        this.unmappedIssuesCollection = new Map<string, SarifViewerVsCodeDiagnostic[]>();
        this.runInfoCollection = [];
    }

    /**
     * Syncs the collection of Diagnostics added with those displayed in the problems panel.
     */
    public syncDiagnostics(): void {
        this.diagnosticCollection.clear();

        this.addToDiagnosticCollection(this.issuesCollection);
        this.addToDiagnosticCollection(this.unmappedIssuesCollection);

        ResultsListController.Instance.postDataToExplorer();
    }

    /**
     * Adds the diagnostic to the collection of diagnostics, seperates them into mapped and umapped diagnositcs
     * After you finish adding all of the new diagnostics, call syncDiagnostics to get them added to the problems panel
     * @param issue diagnostic to add to the problems panel
     */
    public add(issue: SarifViewerVsCodeDiagnostic): void {
        if (issue.resultInfo.assignedLocation.mapped) {
            this.addToCollection(this.issuesCollection, issue);
        } else {
            this.addToCollection(this.unmappedIssuesCollection, issue);
        }

        ResultsListController.Instance.updateResultsListData([issue]);
    }

    /**
     * Adds a RunInfo object to the runinfo collection and returns it's id
     * @param runInfo RunInfo object to add to the collection
     */
    public addRunInfo(runInfo: RunInfo): number {
        runInfo.id = 0;
        if (this.runInfoCollection.length !== 0) {
            runInfo.id = this.runInfoCollection[this.runInfoCollection.length - 1].id + 1;
        }

        this.runInfoCollection.push(runInfo);
        return runInfo.id;
    }

    /**
     * Clears the Problems panel of diagnostics associated with the SARIF Extension
     * and clears all of the Diagnostics that have been added
     */
    public clear(): void {
        this.diagnosticCollection.clear();
        this.issuesCollection.clear();
        this.unmappedIssuesCollection.clear();
        this.runInfoCollection.length = 0;
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        this.diagnosticCollection.dispose();
    }

    /**
     * Gets a flat array of all the diaganostics (includes mapped and unmapped)
     */
    public getAllDiagnostics(): SarifViewerVsCodeDiagnostic[] {
        const allDiags: SarifViewerVsCodeDiagnostic[] = [];
        this.unmappedIssuesCollection.forEach((value) => {
            allDiags.push(...value);
        });

        this.issuesCollection.forEach((value) => {
            allDiags.push(...value);
        });

        return allDiags;
    }

    /**
     * Gets a flat array of all the unmapped diagnostics
     */
    public getAllUnmappedDiagnostics(): SarifViewerVsCodeDiagnostic[] {
        const unmapped: SarifViewerVsCodeDiagnostic[] = [];
        this.unmappedIssuesCollection.forEach((value) => {
            unmapped.push(...value);
        });

        return unmapped;
    }

    /**
     * Gets and returns a Result based on it's run and result Id
     * @param resultId Id of the result
     * @param runId Id of the run the results from
     */
    public getResultInfo(resultId: number, runId: number): SarifViewerVsCodeDiagnostic {
        let result: SarifViewerVsCodeDiagnostic;
        this.unmappedIssuesCollection.forEach((diags: SarifViewerVsCodeDiagnostic[]) => {
            if (result === undefined) {
                result = diags.find((diag: SarifViewerVsCodeDiagnostic) => {
                    if (diag.resultInfo.runId === runId && diag.resultInfo.id === resultId) {
                        return true;
                    }
                });
            }
        });

        if (result === undefined) {
            this.issuesCollection.forEach((diags: SarifViewerVsCodeDiagnostic[]) => {
                if (result === undefined) {
                    result = diags.find((diag: SarifViewerVsCodeDiagnostic) => {
                        if (diag.resultInfo.runId === runId && diag.resultInfo.id === resultId) {
                            return true;
                        }
                    });
                }
            });
        }

        return result;
    }

    /**
     * Returns the runinfo from the runinfo collection corresponding to the id
     * @param id Id of the runinfo to return
     */
    public getRunInfo(id: number): RunInfo {
        return this.runInfoCollection.find((value: RunInfo, index: number, obj: RunInfo[]) => {
            if (value.id === id) {
                return true;
            }
            return false;
        });
    }

    /**
     * Callback to handle whenever a mapping in the FileMapper changes
     * Goes through the diagnostics and tries to remap their locations, if not able to it gets left in the unmapped
     * Also goes through the codeflow locations, to update the locations
     */
    public async mappingChanged(): Promise<void> {
        for (const key of this.issuesCollection.keys()) {
            const issues = this.issuesCollection.get(key);
            for (const index of issues.keys()) {
                await SVDiagnosticFactory.tryToRemapLocations(issues[index]);
            }
        }

        for (const key of this.unmappedIssuesCollection.keys()) {
            const remainingUnmappedIssues = [];
            const explorerDiag = ExplorerController.Instance.activeSVDiagnostic;
            const issues = this.unmappedIssuesCollection.get(key);
            for (const index of issues.keys()) {
                const diag = issues[index];
                await SVDiagnosticFactory.tryToRemapLocations(diag).then((remapped) => {
                    if (remapped) {
                        this.add(diag);
                        ResultsListController.Instance.updateResultsListData([diag]);
                        if (explorerDiag !== undefined && explorerDiag.resultInfo.runId === diag.resultInfo.runId &&
                            explorerDiag.resultInfo.id === diag.resultInfo.id) {
                            ExplorerController.Instance.setActiveDiagnostic(diag, true);
                        }
                    } else {
                        remainingUnmappedIssues.push(issues[index]);
                    }
                });
            }

            if (remainingUnmappedIssues.length === 0) {
                this.unmappedIssuesCollection.delete(key);
            } else if (remainingUnmappedIssues.length !== issues.length) {
                this.unmappedIssuesCollection.set(key, remainingUnmappedIssues);
            }
        }

        this.syncDiagnostics();
    }

    /**
     * Itterates through the issue collections and removes any results that originated from the file
     * @param path Path (including file) of the file that has the runs to be removed
     */
    public removeRuns(path: string) {
        const runsToRemove = new Array<number>();
        for (let i = SVDiagnosticCollection.Instance.runInfoCollection.length - 1; i >= 0; i--) {
            if (SVDiagnosticCollection.Instance.runInfoCollection[i].sarifFileFullPath === path) {
                runsToRemove.push(SVDiagnosticCollection.Instance.runInfoCollection[i].id);
                SVDiagnosticCollection.Instance.runInfoCollection.splice(i, 1);
            }
        }

        this.removeResults(runsToRemove, SVDiagnosticCollection.Instance.issuesCollection);
        this.removeResults(runsToRemove, SVDiagnosticCollection.Instance.unmappedIssuesCollection);
        SVDiagnosticCollection.Instance.syncDiagnostics();
    }

    /**
     * Does the actual action of adding the passed in diagnostic into the passed in collection
     * @param collection dictionary to add the diagnostic to
     * @param issue diagnostic that needs to be added to dictionary
     */
    private addToCollection(collection: Map<string, SarifViewerVsCodeDiagnostic[]>, issue: SarifViewerVsCodeDiagnostic) {
        const key = Utilities.getFsPathWithFragment(issue.resultInfo.assignedLocation.uri);
        if (collection.has(key)) {
            collection.get(key).push(issue);
        } else {
            collection.set(key, [issue]);
        }
    }

    /**
     * Does the work to add the collection into the DiagnosticsCollection used for displaying in the problems panel
     * Handles if the size is larger then the max we stop 1 short and add our custom message as the final diagnostic
     * @param collection dictionary of diagnostics that need to be added to the panel
     */
    private addToDiagnosticCollection(collection: Map<string, SarifViewerVsCodeDiagnostic[]>) {
        for (const issues of collection.values()) {
            let diags: Diagnostic[];
            const key = issues[0].resultInfo.assignedLocation.uri;
            if (issues.length > SVDiagnosticCollection.MaxDiagCollectionSize) {
                const msg = `Only displaying ${SVDiagnosticCollection.MaxDiagCollectionSize} of the total
                    ${issues.length} results in the SARIF log.`;
                const maxReachedDiag = new Diagnostic(new Range(0, 0, 0, 0), msg, DiagnosticSeverity.Error);
                maxReachedDiag.code = SVDiagnosticFactory.Code;
                maxReachedDiag.source = "SARIFViewer";
                diags = [maxReachedDiag].concat(issues.slice(0, SVDiagnosticCollection.MaxDiagCollectionSize));
            } else {
                diags = issues;
            }

            this.diagnosticCollection.set(key, diags);
        }
    }

    /**
     * Removes the results associated with the runids to be removed from the collection
     * @param runsToRemove array of runids to be removed
     * @param collection diagnostic collection to search for matching runids
     */
    private removeResults(runsToRemove: number[], collection: Map<string, SarifViewerVsCodeDiagnostic[]>) : void {
        let diagnosticsRemoved: SarifViewerDiagnostic[] = [];
        for (const key of collection.keys()) {
            const diagnostics: SarifViewerVsCodeDiagnostic[] = collection.get(key) || [];
            for (let i: number = diagnostics.length - 1; i >= 0; i--) {
                for (const runId of runsToRemove) {
                    if (diagnostics[i].resultInfo.runId === runId) {
                        diagnosticsRemoved = diagnosticsRemoved.concat(diagnostics.splice(i, 1));
                        break;
                    }
                }
            }

            if (diagnostics.length === 0) {
                collection.delete(key);
            } else {
                collection.set(key, diagnostics);
            }
        }

        if (diagnosticsRemoved.length > 0) {
            ResultsListController.Instance.updateResultsListData(diagnosticsRemoved, true);
        }
    }
}
