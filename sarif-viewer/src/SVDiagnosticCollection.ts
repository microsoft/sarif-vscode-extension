// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, languages, Range, Uri } from "vscode";
import { FileMapper } from "./FileMapper";
import { ResultLocation } from "./ResultLocation";
import { SVDiagnostic } from "./SVDiagnostic";

/**
 * Manager for the Diagnostic Collection contianing the sarif result diagnostics
 * Allows us to control which diagnostics we send to the Problems panel, so we can show a custom message on max entries
 * And lets us easily try to map those that weren't mapped previously
 */
export class SVDiagnosticCollection {
    private static readonly MaxDiagCollectionSize = 249;

    private diagnosticCollection: DiagnosticCollection;
    private issuesCollection: Map<string, SVDiagnostic[]>;
    private unmappedIssuesCollection: Map<string, SVDiagnostic[]>;

    constructor() {
        this.diagnosticCollection = languages.createDiagnosticCollection(SVDiagnosticCollection.name);
        this.issuesCollection = new Map<string, SVDiagnostic[]>();
        this.unmappedIssuesCollection = new Map<string, SVDiagnostic[]>();
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
    public add(issue: SVDiagnostic) {
        if (issue.resultInfo.locations[0].notMapped) {
            this.addToCollection(this.unmappedIssuesCollection, issue);
        } else {
            this.addToCollection(this.issuesCollection, issue);
        }
    }

    /**
     * Clears the Problems panel of diagnostics associated with the SARIF Extension
     * and clears all of the Diagnostics that have been added
     */
    public clear(): void {
        this.diagnosticCollection.clear();
        this.issuesCollection.clear();
        this.unmappedIssuesCollection.clear();
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        this.diagnosticCollection.dispose();
    }

    /**
     * Callback to handle whenever a mapping in the FileMapper changes
     * Goes through all of the unmapped diagnostics and tries to remap them, if not able to it gets left in the unmapped
     */
    public async mappingChanged() {
        for (const key of this.unmappedIssuesCollection.keys()) {
            const remainingUnmappedIssues = [];
            const issues = this.unmappedIssuesCollection.get(key);
            for (const issue of issues) {
                if (issue.result.locations !== undefined &&
                    issue.result.locations[0] !== undefined &&
                    issue.result.locations[0].resultFile !== undefined &&
                    issue.result.locations[0].resultFile.uri !== undefined) {
                    const uri = Uri.parse(issue.result.locations[0].resultFile.uri);
                    await FileMapper.Instance.map(uri, false, false).then(() => {
                        return ResultLocation.create(issue.result.locations[0].resultFile,
                            issue.result.snippet);
                    }).then((resultLocation: ResultLocation) => {
                        issue.remap(resultLocation);
                        this.add(issue);
                    }, (reason) => {
                        remainingUnmappedIssues.push(issue);
                    });
                }
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
    private addToCollection(collection: Map<string, SVDiagnostic[]>, issue: SVDiagnostic) {
        const key = issue.resultInfo.locations[0].uri;

        if (collection.has(key.path)) {
            collection.get(key.path).push(issue);
        } else {
            collection.set(key.path, [issue]);
        }
    }

    /**
     * Does the work to add the collection into the DiagnosticsCollection used for displaying in the problems panel
     * Handles if the size is larger then the max we stop 1 short and add our custom message as the final diagnostic
     * @param collection dictionary of diagnostics that need to be added to the panel
     */
    private addToDiagnosticCollection(collection: Map<string, SVDiagnostic[]>) {
        for (const issues of collection.values()) {
            let diags: Diagnostic[];
            const key = issues[0].resultInfo.locations[0].uri;
            if (issues.length > SVDiagnosticCollection.MaxDiagCollectionSize) {
                const msg = `Only displaying 249 of the total ${issues.length} results in the SARIF log.`;
                const maxReachedDiag = new Diagnostic(new Range(0, 0, 0, 0), msg, DiagnosticSeverity.Error);
                maxReachedDiag.code = SVDiagnostic.Code;
                maxReachedDiag.source = "SARIFViewer";
                diags = [maxReachedDiag].concat(issues.slice(0, SVDiagnosticCollection.MaxDiagCollectionSize));
            } else {
                diags = issues;
            }

            this.diagnosticCollection.set(key, diags);
        }
    }
}
