// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    DecorationInstanceRenderOptions, DecorationOptions, DecorationRangeBehavior, DiagnosticSeverity, OverviewRulerLane,
    Position, Range, TextEditor, TextEditorRevealType, ViewColumn, window, workspace,
} from "vscode";
import { CodeFlows } from "./CodeFlows";
import { ExplorerContentProvider } from "./ExplorerContentProvider";
import { CodeFlowStep, CodeFlowStepId } from "./Interfaces";
import { Location } from "./Location";
import { Utilities } from "./Utilities";

/**
 * Handles adding and updating the decorations for Code Flows of the current Result open in the Explorer
 */
export class CodeFlowDecorations {

    public static readonly selectNextCFStepCommand = "extension.sarif.nextCodeFlowStep";
    public static readonly selectPrevCFStepCommand = "extension.sarif.previousCodeFlowStep";

    /**
     * Updates the decorations when there is a change in the visible text editors
     */
    public static onVisibleTextEditorsChanged() {
        CodeFlowDecorations.updateStepsHighlight();
        CodeFlowDecorations.updateResultGutterIcon();
    }

    /**
     * Updates the GutterIcon for the current active Diagnostic
     */
    public static updateResultGutterIcon() {
        const activeSVDiagnostic = ExplorerContentProvider.Instance.activeSVDiagnostic;
        if (activeSVDiagnostic !== undefined) {
            for (const editor of window.visibleTextEditors) {
                if (activeSVDiagnostic.resultInfo.assignedLocation.uri.toString() === editor.document.uri.toString()) {
                    const errorDecoration = [];
                    const warningDecoration = [];
                    const infoDecoration = [];
                    const iconRange = new Range(activeSVDiagnostic.range.start, activeSVDiagnostic.range.start);
                    switch (activeSVDiagnostic.severity) {
                        case DiagnosticSeverity.Error:
                            errorDecoration.push(iconRange);
                            break;
                        case DiagnosticSeverity.Warning:
                            warningDecoration.push(iconRange);
                            break;
                        case DiagnosticSeverity.Information:
                            infoDecoration.push(iconRange);
                            break;
                    }

                    editor.setDecorations(CodeFlowDecorations.GutterErrorDecorationType, errorDecoration);
                    editor.setDecorations(CodeFlowDecorations.GutterWarningDecorationType, warningDecoration);
                    editor.setDecorations(CodeFlowDecorations.GutterInfoDecorationType, infoDecoration);

                    break;
                }
            }

        }
    }

    /**
     * Updates the decorations for the steps in the Code Flow tree
     */
    public static updateStepsHighlight() {
        const activeSVDiagnostic = ExplorerContentProvider.Instance.activeSVDiagnostic;
        if (activeSVDiagnostic !== undefined && activeSVDiagnostic.resultInfo.codeFlows !== undefined) {
            // for each visible editor add any of the codeflow locations that match it's Uri
            for (const editor of window.visibleTextEditors) {
                const decorations: DecorationOptions[] = [];
                const unimportantDecorations: DecorationOptions[] = [];
                for (const codeflow of activeSVDiagnostic.resultInfo.codeFlows) {
                    // For now we only support one threadFlow in the code flow
                    for (const step of codeflow.threads[0].steps) {
                        const decoration = CodeFlowDecorations.createHighlightDecoration(step, editor);
                        if (decoration !== undefined) {
                            if (step.importance === sarif.CodeFlowLocation.importance.unimportant) {
                                unimportantDecorations.push(decoration);
                            } else {
                                decorations.push(decoration);
                            }
                        }
                    }
                }

                editor.setDecorations(CodeFlowDecorations.LocationDecorationType, decorations);
                editor.setDecorations(CodeFlowDecorations.UnimportantLocationDecorationType, unimportantDecorations);
            }
        }
    }

    /**
     * Updates the selection to the selected attachment region
     * @param attachmentId Id of the attachment selected
     * @param regionId Id of the region selected
     */
    public static async updateAttachmentSelection(attachmentId: number, regionId: number) {
        const svDiagnostic = ExplorerContentProvider.Instance.activeSVDiagnostic;
        const location = svDiagnostic.resultInfo.attachments[attachmentId].regionsOfInterest[regionId];
        const sarifPhysicalLocation = {
            fileLocation: svDiagnostic.rawResult.attachments[attachmentId].fileLocation,
            region: svDiagnostic.rawResult.attachments[attachmentId].regions[regionId],
        } as sarif.PhysicalLocation;
        const sarifLocation = { physicalLocation: sarifPhysicalLocation } as sarif.Location;

        CodeFlowDecorations.updateSelectionHighlight(location, sarifLocation);
    }

    /**
     * Selects the next CodeFlow step
     */
    public static selectNextCFStep() {
        if (CodeFlowDecorations.lastCodeFlowSelected !== undefined) {
            const nextId = CodeFlowDecorations.lastCodeFlowSelected;
            nextId.stepId++;
            const codeFlows = ExplorerContentProvider.Instance.activeSVDiagnostic.resultInfo.codeFlows;
            if (nextId.stepId >= codeFlows[nextId.cFId].threads[nextId.tFId].steps.length) {
                nextId.stepId = 0;
                nextId.tFId++;
                if (nextId.tFId >= codeFlows[nextId.cFId].threads.length) {
                    nextId.tFId = 0;
                    nextId.cFId++;
                    if (nextId.cFId >= codeFlows.length) {
                        nextId.cFId = 0;
                    }
                }
            }
            CodeFlowDecorations.updateCodeFlowSelection(nextId, undefined);
        }
    }

    /**
     * Selects the previous CodeFlow step
     */
    public static selectPrevCFStep() {
        if (CodeFlowDecorations.lastCodeFlowSelected !== undefined) {
            const prevId = CodeFlowDecorations.lastCodeFlowSelected;
            prevId.stepId--;
            const codeFlows = ExplorerContentProvider.Instance.activeSVDiagnostic.resultInfo.codeFlows;
            if (prevId.stepId < 0) {
                prevId.tFId--;
                if (prevId.tFId < 0) {
                    prevId.cFId--;
                    if (prevId.cFId < 0) {
                        prevId.cFId = codeFlows.length - 1;
                    }
                    prevId.tFId = codeFlows[prevId.cFId].threads.length - 1;
                }
                prevId.stepId = codeFlows[prevId.cFId].threads[prevId.tFId].steps.length - 1;
            }

            CodeFlowDecorations.updateCodeFlowSelection(prevId, undefined);
        }
    }

    /**
     * Updates the decoration that represents the currently selected Code Flow in the Explorer
     * @param id Id object of the Code Flow, set to undefined if using idText
     * @param idText text version of the id of the Code Flow, set to undefined if using id
     */
    public static updateCodeFlowSelection(id: CodeFlowStepId, idText: string) {
        if (idText !== undefined) {
            id = CodeFlows.parseCodeFlowId(idText);
        }

        if (id !== undefined) {
            const diagnostic = ExplorerContentProvider.Instance.activeSVDiagnostic;

            CodeFlowDecorations.updateSelectionHighlight(
                diagnostic.resultInfo.codeFlows[id.cFId].threads[id.tFId].steps[id.stepId].location,
                diagnostic.rawResult.codeFlows[id.cFId].threadFlows[id.tFId].locations[id.stepId].location,
            );

            CodeFlowDecorations.lastCodeFlowSelected = id;
        }
    }

    /**
     * Updates the decoration that represents the currently selected Code Flow in the Explorer
     * @param location processed location to put the highlight at
     * @param sarifLocation raw sarif location used if location isn't mapped to get the user to try to map
     */
    public static async updateSelectionHighlight(location: Location, sarifLocation: sarif.Location): Promise<void> {

        await Location.getOrRemap(location, sarifLocation).then((loc: Location) => {
            location = loc;
        });

        if (location !== undefined && location.mapped) {
            let locRange = location.range;
            if (location.endOfLine === true) {
                locRange = new Range(locRange.start, new Position(locRange.end.line - 1, Number.MAX_VALUE));
            }

            return workspace.openTextDocument(location.uri).then((doc) => {
                return window.showTextDocument(doc, ViewColumn.One, true);
            }).then((editor) => {
                editor.setDecorations(CodeFlowDecorations.SelectionDecorationType,
                    [{ range: locRange }]);
                editor.revealRange(location.range, TextEditorRevealType.InCenterIfOutsideViewport);
            }, (reason) => {
                // Failed to map after asking the user, fail silently as there's no location to add the selection
                return Promise.resolve();
            });
        }
    }

    private static lastCodeFlowSelected: CodeFlowStepId;

    private static GutterErrorDecorationType = window.createTextEditorDecorationType({
        gutterIconPath: Utilities.iconsPath + "error.svg",
    });

    private static GutterInfoDecorationType = window.createTextEditorDecorationType({
        gutterIconPath: Utilities.iconsPath + "info.svg",
    });

    private static GutterWarningDecorationType = window.createTextEditorDecorationType({
        gutterIconPath: Utilities.iconsPath + "warning.svg",
    });

    private static LocationDecorationType = window.createTextEditorDecorationType({
        dark: {
            backgroundColor: "rgba(50,50,200,.5)",
        },
        light: {
            backgroundColor: "rgba(50,50,200,.3)",
        },
        overviewRulerColor: "blue",
        overviewRulerLane: OverviewRulerLane.Left,
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
    });

    private static SelectionDecorationType = window.createTextEditorDecorationType({
        borderStyle: "solid",
        borderWidth: "1px",
        overviewRulerColor: "red",
        overviewRulerLane: OverviewRulerLane.Left,
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
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
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
    });

    /**
     * Creates the decoration, if not able to determine a location returns undefined object
     * @param step the Code Flow step
     * @param editor text editor we check if the location exists in
     */
    private static createHighlightDecoration(step: CodeFlowStep, editor: TextEditor) {
        let decoration;
        if (step.location !== undefined && step.location.mapped &&
            step.location.uri.toString() === editor.document.uri.toString()) {
            let stepRange = step.location.range;
            if (step.location.endOfLine === true) {
                stepRange = new Range(stepRange.start, new Position(stepRange.end.line - 1, Number.MAX_VALUE));
            }

            let beforeDecoration: DecorationInstanceRenderOptions;
            if (step.beforeIcon !== undefined) {
                const beforePath = step.beforeIcon;

                beforeDecoration = {
                    before: {
                        height: "16px",
                        width: "16px",
                    },
                    dark: {
                        before: {
                            contentIconPath: beforePath,
                        },
                    },
                    light: {
                        before: {
                            contentIconPath: beforePath,
                        },
                    },
                };
            }

            decoration = {
                hoverMessage: `[CodeFlow] ${step.messageWithStep}`,
                range: stepRange,
                renderOptions: beforeDecoration,
            } as DecorationOptions;
        }

        return decoration;
    }
}
