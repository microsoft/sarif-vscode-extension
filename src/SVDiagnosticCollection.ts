// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, languages, Range } from "vscode";
import { RunInfo, SarifViewerDiagnostic } from "./common/Interfaces";
import { SVDiagnosticFactory } from "./SVDiagnosticFactory";
import { Utilities } from "./Utilities";

/**
 * Manager for the Diagnostic Collection contianing the sarif result diagnostics
 * Allows us to control which diagnostics we send to the Problems panel, so we can show a custom message on max entries
 * And lets us easily try to map those that weren't mapped previously
 */
export class SVDiagnosticCollection {
    private static readonly MaxDiagCollectionSize = 249;

    private static instance: SVDiagnosticCollection;

    private diagnosticCollection: DiagnosticCollection;
    private issuesCollection: Map<string, SarifViewerDiagnostic[]>;
    private runInfoCollection: RunInfo[];
    private unmappedIssuesCollection: Map<string, SarifViewerDiagnostic[]>;

    public static get Instance(): SVDiagnosticCollection {
        return SVDiagnosticCollection.instance || (SVDiagnosticCollection.instance = new SVDiagnosticCollection());
    }

    private constructor() {
        this.diagnosticCollection = languages.createDiagnosticCollection(SVDiagnosticCollection.name);
        this.issuesCollection = new Map<string, SarifViewerDiagnostic[]>();
        this.unmappedIssuesCollection = new Map<string, SarifViewerDiagnostic[]>();
        this.runInfoCollection = [];
    }

    /**
     * Syncs the collection of Diagnostics added with those displayed in the problems panel.
     */
    public syncDiagnostics() {
        this.diagnosticCollection.clear();

        this.addToDiagnosticCollection(this.issuesCollection);
        this.addToDiagnosticCollection(this.unmappedIssuesCollection);
    }

    /**
     * Adds the diagnostic to the collection of diagnostics, seperates them into mapped and umapped diagnositcs
     * After you finish adding all of the new diagnostics, call syncDiagnostics to get them added to the problems panel
     * @param issue diagnostic to add to the problems panel
     */
    public add(issue: SarifViewerDiagnostic) {
        if (issue.resultInfo.assignedLocation.mapped) {
            this.addToCollection(this.issuesCollection, issue);
        } else {
            this.addToCollection(this.unmappedIssuesCollection, issue);
        }
    }

    /**
     * Adds a RunInfo object to the runinfo collection and returns it's id
     * @param runInfo RunInfo object to add to the collection
     */
    public addRunInfo(runInfo: RunInfo): number {
        const id = this.runInfoCollection.length;
        this.runInfoCollection.push(runInfo);
        return id;
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
     * Returns the runinfo from the runinfo collection corresponding to the id
     * @param id Id of the runinfo to return
     */
    public getRunInfo(id: number): RunInfo {
        return this.runInfoCollection[id];
    }

    /**
     * Callback to handle whenever a mapping in the FileMapper changes
     * Goes through the diagnostics and tries to remap their locations, if not able to it gets left in the unmapped
     * Also goes through the codeflow locations, to update the locations
     */
    public async mappingChanged() {
        for (const key of this.issuesCollection.keys()) {
            const issues = this.issuesCollection.get(key);
            for (const index of issues.keys()) {
                await SVDiagnosticFactory.tryToRemapLocations(issues[index]);
            }
        }

        for (const key of this.unmappedIssuesCollection.keys()) {
            const remainingUnmappedIssues = [];
            const issues = this.unmappedIssuesCollection.get(key);
            for (const index of issues.keys()) {
                await SVDiagnosticFactory.tryToRemapLocations(issues[index]).then((remapped) => {
                    if (remapped) {
                        this.add(issues[index]);
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
     * Does the actual action of adding the passed in diagnostic into the passed in collection
     * @param collection dictionary to add the diagnostic to
     * @param issue diagnostic that needs to be added to dictionary
     */
    private addToCollection(collection: Map<string, SarifViewerDiagnostic[]>, issue: SarifViewerDiagnostic) {
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
    private addToDiagnosticCollection(collection: Map<string, SarifViewerDiagnostic[]>) {
        for (const issues of collection.values()) {
            let diags: Diagnostic[];
            const key = issues[0].resultInfo.assignedLocation.uri;
            if (issues.length > SVDiagnosticCollection.MaxDiagCollectionSize) {
                const msg = `Only displaying 249 of the total ${issues.length} results in the SARIF log.`;
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
}
