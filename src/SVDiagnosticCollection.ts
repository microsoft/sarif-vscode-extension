/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, languages, Range, Uri, Event, EventEmitter, Disposable } from "vscode";
import { RunInfo, SarifViewerDiagnostic } from "./common/Interfaces";
import { ExplorerController } from "./ExplorerController";
import { SVDiagnosticFactory } from "./SVDiagnosticFactory";
import { Utilities } from "./Utilities";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";
import { FileMapper } from "./FileMapper";

export interface SVDiagnosticsChangedEvent {
    diagnostics?: SarifViewerVsCodeDiagnostic[]; // Undefined on synchronize
    type: 'Add' | 'Remove' | 'Synchronize';
}

/**
 * Manager for the Diagnostic Collection contianing the sarif result diagnostics
 * Allows us to control which diagnostics we send to the Problems panel, so we can show a custom message on max entries
 * And lets us easily try to map those that weren't mapped previously
 */
export class SVDiagnosticCollection implements Disposable {
    private disposables: Disposable[] = [];

    private static MaxDiagCollectionSize: number;

    private diagnosticCollection: DiagnosticCollection;
    private issuesCollection: Map<string, SarifViewerVsCodeDiagnostic[]>;
    private runInfoCollection: RunInfo[];
    private unmappedIssuesCollection: Map<string, SarifViewerVsCodeDiagnostic[]>;

    private diagnosticCollectionChangedEventEmitter: EventEmitter<SVDiagnosticsChangedEvent> = new EventEmitter<SVDiagnosticsChangedEvent>();

    public get diagnosticCollectionChanged(): Event<SVDiagnosticsChangedEvent> {
        return this.diagnosticCollectionChangedEventEmitter.event;
    }

    public readonly fileMapper: FileMapper;

    public constructor(private readonly explorerController: ExplorerController) {
        this.disposables.push(this.diagnosticCollectionChangedEventEmitter);
        this.diagnosticCollection = languages.createDiagnosticCollection(SVDiagnosticCollection.name);
        this.disposables.push(this.diagnosticCollection);

        // @ts-ignore: _maxDiagnosticsPerFile does exist on the DiagnosticCollection object
        SVDiagnosticCollection.MaxDiagCollectionSize = this.diagnosticCollection._maxDiagnosticsPerFile - 1;
        this.issuesCollection = new Map<string, SarifViewerVsCodeDiagnostic[]>();
        this.unmappedIssuesCollection = new Map<string, SarifViewerVsCodeDiagnostic[]>();
        this.runInfoCollection = [];

        this.fileMapper = new FileMapper(this);
        this.disposables.push(this.fileMapper);

        this.disposables.push(this.fileMapper.OnMappingChanged(this.mappingChanged.bind(this)));
    }

    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * Syncs the collection of Diagnostics added with those displayed in the problems panel.
     */
    public syncDiagnostics(): void {
        this.diagnosticCollection.clear();

        this.addToDiagnosticCollection(this.issuesCollection);
        this.addToDiagnosticCollection(this.unmappedIssuesCollection);

        this.diagnosticCollectionChangedEventEmitter.fire({
            type: 'Synchronize'
        });
    }

    /**
     * Adds the diagnostic to the collection of diagnostics, separates them into mapped and unmapped diagnostics
     * After you finish adding all of the new diagnostics, call syncDiagnostics to get them added to the problems panel
     * @param issue diagnostic to add to the problems panel
     */
    public add(issue: SarifViewerVsCodeDiagnostic): void {
        if (issue.resultInfo.assignedLocation && issue.resultInfo.assignedLocation.mapped) {
            this.addToCollection(this.issuesCollection, issue);
        } else {
            this.addToCollection(this.unmappedIssuesCollection, issue);
        }

        this.diagnosticCollectionChangedEventEmitter.fire({
            diagnostics: [issue],
            type: 'Add'
        });
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
     * Gets a flat array of all the diagnostics (includes mapped and unmapped)
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
    public getResultInfo(resultId: number, runId: number): SarifViewerVsCodeDiagnostic | undefined {
        let result: SarifViewerVsCodeDiagnostic | undefined;
        this.unmappedIssuesCollection.forEach((diags: SarifViewerVsCodeDiagnostic[]) => {
            if (!result) {
                result = diags.find((diag: SarifViewerVsCodeDiagnostic) => {
                    return (diag.resultInfo.runId === runId && diag.resultInfo.id === resultId);
                });
            }
        });

        if (!result) {
            this.issuesCollection.forEach((diags: SarifViewerVsCodeDiagnostic[]) => {
                if (!result) {
                    result = diags.find((diag: SarifViewerVsCodeDiagnostic) => {
                        return (diag.resultInfo.runId === runId && diag.resultInfo.id === resultId);
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
    public getRunInfo(id: number): RunInfo | undefined {
        return this.runInfoCollection.find((runInfo) => {
            return (runInfo.id === id);
        });
    }

    /**
     * Callback to handle whenever a mapping in the FileMapper changes
     * Goes through the diagnostics and tries to remap their locations, if not able to it gets left in the unmapped
     * Also goes through the codeflow locations, to update the locations
     */
    public async mappingChanged(): Promise<void> {
        for (const key of this.issuesCollection.keys()) {
            const issues: SarifViewerDiagnostic[] | undefined = this.issuesCollection.get(key);
            if (!issues) {
                continue;
            }

            for (const index of issues.keys()) {
                await SVDiagnosticFactory.tryToRemapLocations(this.explorerController, issues[index]);
            }
        }

        const explorerDiag: SarifViewerVsCodeDiagnostic | undefined = this.explorerController.activeDiagnostic;
        if (!explorerDiag) {
            return;
        }

        for (const key of this.unmappedIssuesCollection.keys()) {
            const issues: SarifViewerVsCodeDiagnostic[] | undefined = this.unmappedIssuesCollection.get(key);
            if (!issues) {
                return;
            }

            const remainingUnmappedIssues: SarifViewerVsCodeDiagnostic[] = [];
            for (const index of issues.keys()) {
                const diag: SarifViewerVsCodeDiagnostic = issues[index];
                await SVDiagnosticFactory.tryToRemapLocations(this.explorerController, diag).then((remapped) => {
                    if (remapped) {
                        this.add(diag);
                        this.diagnosticCollectionChangedEventEmitter.fire({
                            diagnostics: [diag],
                            type: 'Add'
                        });
                        if (explorerDiag !== undefined && explorerDiag.resultInfo.runId === diag.resultInfo.runId &&
                            explorerDiag.resultInfo.id === diag.resultInfo.id) {
                            this.explorerController.setActiveDiagnostic(diag, true);
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
    public removeRuns(path: string): void {
        const runsToRemove: number[] = [];
        for (let i: number = this.runInfoCollection.length - 1; i >= 0; i--) {
            if (this.runInfoCollection[i].sarifFileFullPath === path) {
                runsToRemove.push(this.runInfoCollection[i].id);
                this.runInfoCollection.splice(i, 1);
            }
        }

        this.removeResults(runsToRemove, this.issuesCollection);
        this.removeResults(runsToRemove, this.unmappedIssuesCollection);
        this.syncDiagnostics();
    }

    /**
     * Does the actual action of adding the passed in diagnostic into the passed in collection
     * @param collection dictionary to add the diagnostic to
     * @param issue diagnostic that needs to be added to dictionary
     */
    private addToCollection(collection: Map<string, SarifViewerVsCodeDiagnostic[]>, issue: SarifViewerVsCodeDiagnostic): void {
        if (!issue.resultInfo.assignedLocation || !issue.resultInfo.assignedLocation.uri) {
            return;
        }

        const key: string = Utilities.getFsPathWithFragment(issue.resultInfo.assignedLocation.uri);
        const diagnostics: SarifViewerVsCodeDiagnostic[] | undefined = collection.get(key);

        if (diagnostics) {
            diagnostics.push(issue);
        } else {
            collection.set(key, [issue]);
        }
    }

    /**
     * Does the work to add the collection into the DiagnosticsCollection used for displaying in the problems panel
     * Handles if the size is larger then the max we stop 1 short and add our custom message as the final diagnostic
     * @param collection dictionary of diagnostics that need to be added to the panel
     */
    private addToDiagnosticCollection(collection: Map<string, SarifViewerVsCodeDiagnostic[]>): void {
        for (const issues of collection.values()) {
            let diags: Diagnostic[];
            if (!issues[0].resultInfo.assignedLocation || !issues[0].resultInfo.assignedLocation.uri) {
                continue;
            }

            const key: Uri = issues[0].resultInfo.assignedLocation.uri;
            if (issues.length > SVDiagnosticCollection.MaxDiagCollectionSize) {
                const msg: string = `Only displaying ${SVDiagnosticCollection.MaxDiagCollectionSize} of the total
                    ${issues.length} results in the SARIF log.`;
                const maxReachedDiag: Diagnostic = new Diagnostic(new Range(0, 0, 0, 0), msg, DiagnosticSeverity.Error);
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
    private removeResults(runsToRemove: number[], collection: Map<string, SarifViewerVsCodeDiagnostic[]>): void {
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
            this.diagnosticCollectionChangedEventEmitter.fire( {
                diagnostics: diagnosticsRemoved,
                type: 'Remove'
            });
        }
    }
}
