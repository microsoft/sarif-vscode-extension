// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    DecorationOptions, OverviewRulerLane, TextEditor, TextEditorRevealType, Uri, ViewColumn, window, workspace,
} from "vscode";
import { ExplorerContentProvider } from "./ExplorerContentProvider";
import { FileMapper } from "./FileMapper";
import { ResultLocation } from "./ResultLocation";

/**
 * Handles adding and updating the decorations for Code Flows of the current Result open in the Explorer
 */
export class CodeFlowDecorations {
    /**
     * Updates the decorations for the locations in the Code Flow tree
     * ToDo: rusty: refactor to generate the set of highlight decorations once to itterate through later
     *              Will need to hook into the remapping event and recreate decorations
     */
    public static async updateLocationsHighlight() {
        const activeSVDiagnostic = ExplorerContentProvider.Instance.activeSVDiagnostic;
        if (activeSVDiagnostic !== undefined && activeSVDiagnostic.rawResult.codeFlows !== undefined
            && activeSVDiagnostic.rawResult.codeFlows.length > 0) {

            // for each visible editor add any of the codeflow locations that match it's Uri
            for (const editor of window.visibleTextEditors) {
                const decorations: DecorationOptions[] = [];
                const unimportantDecorations: DecorationOptions[] = [];
                for (const codeflow of activeSVDiagnostic.rawResult.codeFlows) {
                    for (const location of codeflow.locations) {
                        await CodeFlowDecorations.createHighlightDecoration(location, editor).then((decoration) => {
                            if (decoration === undefined) { return; }

                            if (location.importance === sarif.AnnotatedCodeLocation.importance.unimportant) {
                                unimportantDecorations.push(decoration);
                            } else {
                                decorations.push(decoration);
                            }
                        });
                    }
                }

                editor.setDecorations(CodeFlowDecorations.LocationDecorationType, decorations);
                editor.setDecorations(CodeFlowDecorations.UnimportantLocationDecorationType,
                    unimportantDecorations);
            }

        }
    }

    /**
     * Updates the decoration that represents the currently selected Code Flow in the Explorer
     * @param treeId Id of the Code Flow tree the selection is in
     * @param stepId Id of the step in the tree that is selected
     */
    public static async updateSelectionHighlight(treeId: string, stepId: string): Promise<void> {
        const svDiagnostic = ExplorerContentProvider.Instance.activeSVDiagnostic;
        const cfLocation: sarif.AnnotatedCodeLocation = svDiagnostic.rawResult.codeFlows[treeId].locations[stepId];
        if (cfLocation.physicalLocation !== undefined) {
            let resultLocation: ResultLocation;
            await ResultLocation.create(cfLocation.physicalLocation,
                cfLocation.snippet).then((location: ResultLocation) => {
                    if (location.mapped) {
                        resultLocation = location;
                    } else {
                        // file mapping wasn't found, try to get the user to choose file
                        const uri = Uri.parse(cfLocation.physicalLocation.uri);
                        return FileMapper.Instance.getUserToChooseFile(uri).then(() => {
                            return ResultLocation.create(cfLocation.physicalLocation, cfLocation.snippet);
                        }).then((choosenLoc) => {
                            resultLocation = choosenLoc;
                        });
                    }
                }).then(() => {
                    return workspace.openTextDocument(resultLocation.uri);
                }).then((doc) => {
                    return window.showTextDocument(doc, ViewColumn.One, true);
                }).then((editor) => {
                    editor.setDecorations(CodeFlowDecorations.SelectionDecorationType,
                        [{ range: resultLocation.range }]);
                    editor.revealRange(resultLocation.range, TextEditorRevealType.InCenterIfOutsideViewport);
                }, (reason) => {
                    // Failed to map after asking the user, fail silently as there's no location to add the selection
                    return Promise.resolve();
                });
        }
    }

    private static LocationDecorationType = window.createTextEditorDecorationType({
        dark: {
            backgroundColor: "rgba(50,50,200,.5)",
        },
        light: {
            backgroundColor: "rgba(50,50,200,.3)",
        },
        overviewRulerColor: "blue",
        overviewRulerLane: OverviewRulerLane.Left,
    });

    private static SelectionDecorationType = window.createTextEditorDecorationType({
        borderStyle: "solid",
        borderWidth: "1px",
        overviewRulerColor: "red",
        overviewRulerLane: OverviewRulerLane.Left,
    });

    private static UnimportantLocationDecorationType = window.createTextEditorDecorationType({
        dark: {
            backgroundColor: "rgba(150,150,150,.4)",
        },
        light: {
            backgroundColor: "rgba(150,150,150,.4)",
        },
        overviewRulerColor: "grey",
        overviewRulerLane: OverviewRulerLane.Left,
    });

    /**
     * Creates the decoration, if not able to determine a location returns undefined object
     * @param location Location associated with the Code Flow step
     * @param editor text editor we check if the location exists in
     */
    private static createHighlightDecoration(location: sarif.AnnotatedCodeLocation, editor: TextEditor): Promise<any> {
        if (location.physicalLocation === undefined) {
            // The code flow doesn't have a location so there's no highlight to create
            return Promise.resolve();
        }

        return ResultLocation.create(location.physicalLocation,
            location.snippet).then((resultLocation: ResultLocation) => {
                if (resultLocation.mapped && resultLocation.uri.toString() === editor.document.uri.toString()) {
                    const decoration = {
                        hoverMessage: `[CodeFlow] Step ${location.step}: ${location.message ||
                            location.target || location.importance || ""}`,
                        range: resultLocation.range,
                        renderOptions: undefined,
                    };

                    return Promise.resolve(decoration);
                } else {
                    return Promise.resolve(undefined);
                }
            }, (reason) => {
                // The code flow location hasn't been mapped yet so there's no highlight to add
                return Promise.resolve(undefined);
            });
    }
}
