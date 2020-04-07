/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */
import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, languages, Range, Uri, Event, EventEmitter, Disposable, workspace, TextDocument, window, TextEditorSelectionChangeEvent } from "vscode";
import { RunInfo, Location } from "./common/Interfaces";
import { Utilities } from "./Utilities";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";

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
    private disposables: Disposable[] = [];

    private static MaxDiagCollectionSize: number;

    private readonly diagnosticCollection: DiagnosticCollection;

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

    private runInfoCollection: RunInfo[] = [];

    private diagnosticCollectionChangedEventEmitter: EventEmitter<SVDiagnosticsChangedEvent> = new EventEmitter<SVDiagnosticsChangedEvent>();

    // Active diagnostic and corresponding event.
    private activeSVDiagnostic: SarifViewerVsCodeDiagnostic | undefined;

    private onDidChangeActiveDiagnosticEventEmitter: EventEmitter<SarifViewerVsCodeDiagnostic | undefined> = new EventEmitter<SarifViewerVsCodeDiagnostic | undefined>();

    public constructor() {
        this.disposables.push(this.diagnosticCollectionChangedEventEmitter);
        this.disposables.push(this.onDidChangeActiveDiagnosticEventEmitter);

        this.diagnosticCollection = languages.createDiagnosticCollection(SVDiagnosticCollection.name);
        this.disposables.push(this.diagnosticCollection);

        // @ts-ignore: _maxDiagnosticsPerFile does exist on the DiagnosticCollection object
        SVDiagnosticCollection.MaxDiagCollectionSize = this.diagnosticCollection._maxDiagnosticsPerFile - 1;

        this.disposables.push(window.onDidChangeTextEditorSelection(this.onDidChangeTextEditorSelection.bind(this)));
        this.disposables.push(workspace.onDidCloseTextDocument(this.onDocumentClosed.bind(this)));
    }

    public get onDidChangeActiveDiagnostic(): Event<SarifViewerVsCodeDiagnostic | undefined> {
        return this.onDidChangeActiveDiagnosticEventEmitter.event;
    }

    public get diagnosticCollectionChanged(): Event<SVDiagnosticsChangedEvent> {
        return this.diagnosticCollectionChangedEventEmitter.event;
    }

    public get activeDiagnostic(): SarifViewerVsCodeDiagnostic | undefined {
        return this.activeSVDiagnostic;
    }

    public set activeDiagnostic(value: SarifViewerVsCodeDiagnostic | undefined) {
        if (this.activeSVDiagnostic !== value) {
            this.activeSVDiagnostic = value;
            this.onDidChangeActiveDiagnosticEventEmitter.fire(value);
        }
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
        if (issue.location.hasBeenMapped) {
            this.addToCollection(this.mappedIssuesCollection, issue);
        } else {
            if (issue.resultInfo.assignedLocation) {
                this.disposables.push(issue.resultInfo.assignedLocation.onLocationMapped()((location) => (this.locationMapped(issue, location))));
            }
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
    public addRunInfo(runInfo: RunInfo): void {
        this.runInfoCollection.push(runInfo);
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

        this.removeResults(runsToRemove, this.mappedIssuesCollection);
        this.removeResults(runsToRemove, this.unmappedIssuesCollection);
        this.syncDiagnostics();
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
            const key: Uri | undefined = issues[0].location.uri;
            if (!key) {
                return;
            }

            let diags: Diagnostic[];

            if (issues.length > SVDiagnosticCollection.MaxDiagCollectionSize) {
                const msg: string = `Only displaying ${SVDiagnosticCollection.MaxDiagCollectionSize} of the total
                    ${issues.length} results in the SARIF log.`;
                const maxReachedDiag: Diagnostic = new Diagnostic(new Range(0, 0, 0, 0), msg, DiagnosticSeverity.Error);
                maxReachedDiag.code = "SARIFReader";
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
            this.diagnosticCollectionChangedEventEmitter.fire( {
                diagnostics: diagnosticsRemoved,
                type: 'Remove'
            });
        }
    }

    /**
     * When a sarif document closes we need to clear all of the list of issues and reread the open sarif docs
     * Can't selectivly remove issues becuase the issues don't have a link back to the sarif file it came from
     * @param doc document that was closed
     */
    public onDocumentClosed(doc: TextDocument): void {
        if (Utilities.isSarifFile(doc)) {
            this.removeRuns(doc.fileName);
        }
    }

    private locationMapped(diagnostic: SarifViewerVsCodeDiagnostic, location: Location): void {
        for (const [key, unmappedDiagnostics] of this.unmappedIssuesCollection.entries()) {
            const indexOfUnmappedDiagnostic: number = unmappedDiagnostics.indexOf(diagnostic);
            if (indexOfUnmappedDiagnostic >= 0) {
                unmappedDiagnostics.splice(indexOfUnmappedDiagnostic, 1);
                this.unmappedIssuesCollection.set(key, unmappedDiagnostics);
                break;
            }
        }

        this.addToCollection(this.mappedIssuesCollection, new SarifViewerVsCodeDiagnostic(diagnostic.runInfo, diagnostic.resultInfo, diagnostic.rawResult, location));

        this.syncDiagnostics();
    }

    private onDidChangeTextEditorSelection(textEditorSelectionChanged: TextEditorSelectionChangeEvent ): void {
        // If the selection changed to a text editor that isn't visible, then we will ignore it.
        if (!window.visibleTextEditors.find((visibleTextEdtior) => visibleTextEdtior === textEditorSelectionChanged.textEditor)) {
            return;
        }

        // If there isn't a valid selction, then we will also ignore it.
        if (textEditorSelectionChanged.selections.length <= 0 ) {
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
        const firstRange: Range = textEditorSelectionChanged.selections[0];
        for (const diagnosticForDocument of diagnosticsForDocument) {
            if (diagnosticForDocument.location.range.intersection(firstRange)) {
                this.activeDiagnostic = diagnosticForDocument;
                break;
            }
        }
    }
}
