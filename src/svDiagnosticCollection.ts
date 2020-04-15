/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, languages, Range, Uri, Event, EventEmitter, Disposable,  window, TextEditorSelectionChangeEvent } from "vscode";
import { RunInfo, Location } from "./common/interfaces";
import { Utilities } from "./utilities";
import { SarifViewerVsCodeDiagnostic } from "./sarifViewerDiagnostic";
import { ParseResults } from './logReader';

export interface SVDiagnosticsChangedEvent {
    diagnostics: SarifViewerVsCodeDiagnostic[];
    type: 'Add' | 'Remove' | 'Synchronize';
}

/**
 * Manager for the Diagnostic Collection contianing the sarif result diagnostics
 * Allows us to control which diagnostics we send to the Problems panel, so we can show a custom message on max entries
 * And lets us easily try to map those that weren't mapped previously
 */
export class SVDiagnosticCollection implements Disposable {
    /**
     * Contains the list of disposable objects that this class owns.
     */
    private disposables: Disposable[] = [];

    private static MaxDiagCollectionSize: number;

    /**
     * The diagnostic collection we will present to VSCode.
     */
    private readonly diagnosticCollection: DiagnosticCollection = languages.createDiagnosticCollection(SVDiagnosticCollection.name);

    /**
     * The 'mapped' collection cotnains diagnostics that have had their file-paths mapped to a local path.
     * The "key" is the Uri to the mapped file (i.e. file://a/b/c/foo.cpp)
     */
    private readonly mappedIssuesCollection: Map<string, SarifViewerVsCodeDiagnostic[]> = new Map<string, SarifViewerVsCodeDiagnostic[]>();

    /**
     * The 'unmapped' collection, have not had their file paths mapped.
     * The "key" is the Uri to the SARIF file that holds the unmapped result.
     */
    private readonly unmappedIssuesCollection: Map<string, SarifViewerVsCodeDiagnostic[]> = new Map<string, SarifViewerVsCodeDiagnostic[]>();

    /**
     * When we change our diagnostics collection, we fire this event so the results list controller can make sure that the "Web view"
     * is up to date.
     */
    private diagnosticCollectionChangedEventEmitter: EventEmitter<SVDiagnosticsChangedEvent> = new EventEmitter<SVDiagnosticsChangedEvent>();

    // Active diagnostic and corresponding event.
    private activeSVDiagnostic: SarifViewerVsCodeDiagnostic | undefined;

    private onDidChangeActiveDiagnosticEventEmitter: EventEmitter<SarifViewerVsCodeDiagnostic | undefined> = new EventEmitter<SarifViewerVsCodeDiagnostic | undefined>();

    /**
     * The collection of runs the diagnostic collection knows about.
     * Used to clear VSCode's problems pane when a document closed, and to locate diagnostics when a "result selection" is clicked
     * in the web-view.
     */
    private runInfoCollection: RunInfo[] = [];

    /**
     * Flag used to prevent us from synchronizing diagnostics (meaning giving to VSCode and the result-list) while
     * we are trying to auto-remap diagnostic location to their local files.
     */
    private remappingDiagnostics: boolean = false;

    /**
     * Used to keep track of the diagnostics indices that need to be remapped after automatic remapping is complete.
     */
    private remappedDiagnosticsIndices: Map<string, number[]> = new Map<string, number[]>();

    /**
     * Constructs a new instance of the diagnostic collection.
     */
    public constructor() {
        this.disposables.push(this.diagnosticCollectionChangedEventEmitter);
        this.disposables.push(this.onDidChangeActiveDiagnosticEventEmitter);
        this.disposables.push(this.diagnosticCollection);

        // @ts-ignore: _maxDiagnosticsPerFile does exist on the DiagnosticCollection object
        SVDiagnosticCollection.MaxDiagCollectionSize = this.diagnosticCollection._maxDiagnosticsPerFile - 1;

        // Subscribe to the text editor selection changed.
        // During selection changed, we will attempt to find a diagnostic that is in the "Selected"
        // range. If we find it, we will make that the active diagnostic (which in turn causes pretty much all the UI to update).
        this.disposables.push(window.onDidChangeTextEditorSelection(this.onDidChangeTextEditorSelection.bind(this)));
    }

    /**
     * Fired when the active diagnostic changes.
     */
    public get onDidChangeActiveDiagnostic(): Event<SarifViewerVsCodeDiagnostic | undefined> {
        return this.onDidChangeActiveDiagnosticEventEmitter.event;
    }

    /**
     * Fired when the diagnostic collection changes.
     */
    public get diagnosticCollectionChanged(): Event<SVDiagnosticsChangedEvent> {
        return this.diagnosticCollectionChangedEventEmitter.event;
    }

    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * Syncs the collection of Diagnostics added with those displayed in the problems panel.
     */
    public syncIssuesWithDiagnosticCollection(): void {
        this.diagnosticCollection.clear();

        this.addToDiagnosticCollection(this.mappedIssuesCollection);
        this.addToDiagnosticCollection(this.unmappedIssuesCollection);

        this.diagnosticCollectionChangedEventEmitter.fire({
            diagnostics: [],
            type: 'Synchronize'
        });
    }

    /**
     * Adds the diagnostic to the collection of diagnostics, separates them into mapped and unmapped diagnostics
     * After you finish adding all of the new diagnostics, call syncDiagnostics to get them added to the problems panel
     * @param issue diagnostic to add to the problems panel
     */
    public add(issue: SarifViewerVsCodeDiagnostic): void {
        if (issue.location.mappedToLocalPath) {
            this.addToCollection(this.mappedIssuesCollection, issue);
        } else {
            if (issue.resultInfo.assignedLocation) {
                this.disposables.push(issue.resultInfo.assignedLocation.locationMapped((location) => (this.locationMapped(issue, location))));
            }
            this.addToCollection(this.unmappedIssuesCollection, issue);
        }

        this.diagnosticCollectionChangedEventEmitter.fire({
            diagnostics: [issue],
            type: 'Add'
        });
    }

    /**
     * Clears the Problems panel of diagnostics associated with the SARIF Extension
     * and clears all of the Diagnostics that have been added
     */
    public clear(): void {
        this.diagnosticCollection.clear();
        this.mappedIssuesCollection.clear();
        this.unmappedIssuesCollection.clear();
        this.runInfoCollection.length = 0;
    }

    /**
     * Gets a flat array of all the unmapped diagnostics
     * @param sarifFileUri The Sarif file for which to get the unmapped diagnostics from.
     */
    public getAllUnmappedDiagnostics(sarifFileUri: Uri): SarifViewerVsCodeDiagnostic[] {
        const unmappedKey: string = Utilities.getFsPathWithFragment(sarifFileUri);
        return this.unmappedIssuesCollection.get(unmappedKey) || [];
    }

    /**
     * Gets and returns a Result based on it's run and result Id
     * @param resultId Id of the result
     * @param runId Id of the run the results from
     */
    public getResultInfo(resultId: number, runId: number): SarifViewerVsCodeDiagnostic | undefined {
        for (const unmappedIssuesCollection of this.unmappedIssuesCollection.values()) {
            const result: SarifViewerVsCodeDiagnostic | undefined = unmappedIssuesCollection.find((diag: SarifViewerVsCodeDiagnostic) => diag.resultInfo.runId === runId && diag.resultInfo.id === resultId);
            if (result) {
                return result;
            }
        }

        for (const mappedIssuesCollection of this.mappedIssuesCollection.values()) {
            const result: SarifViewerVsCodeDiagnostic | undefined = mappedIssuesCollection.find((diag: SarifViewerVsCodeDiagnostic) => diag.resultInfo.runId === runId && diag.resultInfo.id === resultId);
            if (result) {
                return result;
            }
        }

        return undefined;
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
     * Adds read results to the collection of diagnostics.
     * @param parseResults Results to add.
     */
    public addParseResults(parseResults: ParseResults[]): void {
        for (const parseResult of parseResults) {
            this.runInfoCollection.push(parseResult.runInfo);
            for (const resultInfo of parseResult.results) {
                if (resultInfo.assignedLocation) {
                    const diagnostic: SarifViewerVsCodeDiagnostic = new SarifViewerVsCodeDiagnostic(parseResult.runInfo, resultInfo, resultInfo.rawResult, resultInfo.assignedLocation.mappedToLocalPath ? resultInfo.assignedLocation : resultInfo.resultLocationInSarifFile);
                    this.add(diagnostic);
                }
            }
        }

        this.syncIssuesWithDiagnosticCollection();
    }

    /**
     * Itterates through the issue collections and removes any results that originated from the file
     * @param sarifFile Path (including file) of the file that has the runs to be removed
     */
    public removeRuns(sarifFile: Uri): void {
        if (!sarifFile.isSarifFile()) {
            return;
        }

        const runsToRemove: number[] = [];
        for (let i: number = this.runInfoCollection.length - 1; i >= 0; i--) {
            if (this.runInfoCollection[i].sarifFileFullPath === sarifFile.fsPath) {
                runsToRemove.push(this.runInfoCollection[i].id);
                this.runInfoCollection.splice(i, 1);
            }
        }

        this.removeResults(runsToRemove, this.mappedIssuesCollection);
        this.removeResults(runsToRemove, this.unmappedIssuesCollection);
        this.syncIssuesWithDiagnosticCollection();
    }

    /**
     * Removes all information from the diagnostic collection.
     */
    public removeAllRuns(): void {
        this.runInfoCollection.length = 0;
        this.mappedIssuesCollection.clear();
        this.unmappedIssuesCollection.clear();
        this.syncIssuesWithDiagnosticCollection();
    }

    /**
     * Sets the active diagnostic in the collection and fires the active diagnostic changed event.
     * @param newDiagnostic The new diagnostic to set.
     */
    private set activeDiagnostic(newDiagnostic: SarifViewerVsCodeDiagnostic | undefined) {
        if (this.activeSVDiagnostic !== newDiagnostic) {
            this.activeSVDiagnostic = newDiagnostic;
            this.onDidChangeActiveDiagnosticEventEmitter.fire(newDiagnostic);
        }
    }

    /**
     * Does the actual action of adding the passed in diagnostic into the passed in collection
     * @param collection dictionary to add the diagnostic to
     * @param issue diagnostic that needs to be added to dictionary
     */
    private addToCollection(collection: Map<string, SarifViewerVsCodeDiagnostic[]>, issue: SarifViewerVsCodeDiagnostic): void {
        if (!issue.location.uri) {
            return;
        }

        const key: string = Utilities.getFsPathWithFragment(issue.location.uri);
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
            if (issues.length === 0) {
                continue;
            }

            const key: Uri | undefined = issues[0].location.uri;
            if (!key) {
                return;
            }

            let diags: Diagnostic[];

            if (issues.length > SVDiagnosticCollection.MaxDiagCollectionSize) {
                const msg: string =  localize('diagnosticCollection.limitingResults', "Only displaying {0} of the total {1} results in the SARIF log.", SVDiagnosticCollection.MaxDiagCollectionSize, issues.length);
                const maxReachedDiag: Diagnostic = new Diagnostic(new Range(0, 0, 0, 0), msg, DiagnosticSeverity.Error);
                maxReachedDiag.code = 'SARIFReader';
                maxReachedDiag.source = 'SARIFViewer';
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
        let diagnosticsRemoved: SarifViewerVsCodeDiagnostic[] = [];
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
            this.diagnosticCollectionChangedEventEmitter.fire({
                diagnostics: diagnosticsRemoved,
                type: 'Remove'
            });
        }
    }

    /**
     * Called when a location has been mapped
     * @param diagnostic The diagnostic whose location was mapped to a local file.
     * @param mappedLocation The newly mapped location.
     */
    private async locationMapped(diagnostic: SarifViewerVsCodeDiagnostic, mappedLocation: Location): Promise<void> {
        for (const [key, unmappedDiagnostics] of this.unmappedIssuesCollection.entries()) {
            const indexOfUnmappedDiagnostic: number = unmappedDiagnostics.indexOf(diagnostic);
            if (indexOfUnmappedDiagnostic >= 0) {
                // We cannot "slice" the unmapped diagnostic collection here because
                // when we attempt to remap the remaining diagnostics below (which is async), we cannot
                // iterate and modify the array in place at the same time.
                let existingIndices: number[] | undefined = this.remappedDiagnosticsIndices.get(key);
                if (!existingIndices) {
                    existingIndices = [];
                    this.remappedDiagnosticsIndices.set(key, existingIndices);
                }

                existingIndices.push(indexOfUnmappedDiagnostic);

                // Move it over to the mapped location list, we will handle moving it out of the unmapped collection below.
                diagnostic.updateToMappedLocation(mappedLocation);
                this.addToCollection(this.mappedIssuesCollection, diagnostic);
                break;
            }
        }

        if (!this.remappingDiagnostics) {
            // Since this can cause other calls to this function (locationMapped)
            // we don't want to synchronize the diagnostics repeatedly while it occurs.
            this.remappingDiagnostics = true;
            for (const remainingUnmappedDiagnosticCollections of this.unmappedIssuesCollection.values()) {
                for (const remainingUnmappedDiagnostic of remainingUnmappedDiagnosticCollections) {
                    await remainingUnmappedDiagnostic.attemptToMapLocation({ promptUser: false });
                }
            }
            this.remappingDiagnostics = false;
        }

        if (!this.remappingDiagnostics) {
            for (const [key, unmappedDiagnosticIndices] of this.remappedDiagnosticsIndices) {
                const unmappedDiagnosticCollection: SarifViewerVsCodeDiagnostic[] | undefined =  this.unmappedIssuesCollection.get(key);
                if (!unmappedDiagnosticCollection) {
                    throw new Error('Expected to be able to find diagnostic collection during remapping');
                }

                // We need to walk through the indices backwards so that when we slice the unmapped diagnostic
                // collection the indices remain valid.
                const sortedIndices: number[] = unmappedDiagnosticIndices.sort((a, b) => b - a);
                for (const unmappedDiagnosticIndex of sortedIndices) {
                    unmappedDiagnosticCollection.splice(unmappedDiagnosticIndex, 1);
                }

                // If there is nothing left, then delete the key from the unmapped issue collection.
                if (unmappedDiagnosticCollection.length === 0) {
                    this.unmappedIssuesCollection.delete(key);
                }
            }

            this.remappedDiagnosticsIndices.clear();
            this.syncIssuesWithDiagnosticCollection();
        }
    }

    /**
     * Called when a selection in a text editor changes. When this occurs, we attempt to find
     * the diagnostic that applies to the selected range. If we can find it, we set
     * that as the active selection which causes pretty much all the UI to update.
     * @param textEditorSelectionChanged The type of text editor selection change.
     */
    private onDidChangeTextEditorSelection(textEditorSelectionChanged: TextEditorSelectionChangeEvent): void {
        // If the selection changed to a text editor that isn't visible, then we will ignore it.
        if (!window.visibleTextEditors.find((visibleTextEdtior) => visibleTextEdtior === textEditorSelectionChanged.textEditor)) {
            return;
        }

        // If there isn't a valid selction, then we will also ignore it.
        if (textEditorSelectionChanged.selections.length !== 1) {
            return;
        }

        // If the selection isn't a single line (or isn't empty - meaning just the cursor), then skip it.
        const firstRange: Range = textEditorSelectionChanged.selections[0];
        if (!firstRange.isSingleLine || !firstRange.isEmpty) {
            return;
        }

        // Get the diagnostics for the document.
        const key: string = Utilities.getFsPathWithFragment(textEditorSelectionChanged.textEditor.document.uri);
        const diagnosticsForDocument: SarifViewerVsCodeDiagnostic[] | undefined = this.mappedIssuesCollection.get(key) || this.unmappedIssuesCollection.get(key);
        if (!diagnosticsForDocument) {
            return;
        }

        // Now, if we can find an intersection between the selection and a diagnostic range then
        // make that the active diagnostic.
        for (const diagnosticForDocument of diagnosticsForDocument) {
            // So for single point ranges in SARIF locations (which is apparently common),
            // If the location range is empty (which means single point) and a single line
            // and it is on the same line as the selection, then let's use it.
            // Otherwise, if they intersect, use it as well.
            const diagnosticRang: Range = diagnosticForDocument.location.range;
            if ((diagnosticRang.isEmpty &&
                diagnosticRang.isSingleLine &&
                diagnosticRang.start.line === firstRange.start.line) ||
                (diagnosticRang.intersection(firstRange))) {
                this.activeDiagnostic = diagnosticForDocument;
                break;
            }
        }
    }
}
