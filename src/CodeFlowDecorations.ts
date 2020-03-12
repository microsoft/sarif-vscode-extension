/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import {
    DecorationInstanceRenderOptions, DecorationOptions, DecorationRangeBehavior, DiagnosticSeverity, OverviewRulerLane,
    Position, Range, TextEditor, TextEditorDecorationType, TextEditorRevealType, Uri, ViewColumn, window, workspace, TextDocument,
} from "vscode";
import { CodeFlowStep, CodeFlowStepId, Location, CodeFlow, SarifViewerDiagnostic } from "./common/Interfaces";
import { ExplorerController } from "./ExplorerController";
import { LocationFactory } from "./LocationFactory";
import { Utilities } from "./Utilities";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";
import { CodeFlows } from "./CodeFlows";

/**
 * Handles adding and updating the decorations for Code Flows of the current Result open in the Explorer
 */
export class CodeFlowDecorations {

    public static readonly selectNextCFStepCommand = "extension.sarif.nextCodeFlowStep";
    public static readonly selectPrevCFStepCommand = "extension.sarif.previousCodeFlowStep";

    /**
     * Updates the decorations when there is a change in the visible text editors
     */
    public static onVisibleTextEditorsChanged(): void {
        CodeFlowDecorations.updateStepsHighlight();
        CodeFlowDecorations.updateResultGutterIcon();
    }

    /**
     * Updates the GutterIcon for the current active Diagnostic
     */
    public static updateResultGutterIcon(): void {
        const activeSVDiagnostic: SarifViewerVsCodeDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
        if (activeSVDiagnostic !== undefined) {
            for (const editor of window.visibleTextEditors) {
                if (activeSVDiagnostic.resultInfo &&
                    activeSVDiagnostic.resultInfo.assignedLocation &&
                    activeSVDiagnostic.resultInfo.assignedLocation.uri &&
                    activeSVDiagnostic.resultInfo.assignedLocation.uri.toString() === editor.document.uri.toString()) {
                    const errorDecoration: Range[] = [];
                    const warningDecoration: Range[] = [];
                    const infoDecoration: Range[] = [];
                    const iconRange: Range = new Range(activeSVDiagnostic.range.start, activeSVDiagnostic.range.start);
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
                        default:
                            // What should the default be exactly?
                            // There are 'hints' as well in VSCode.
                            warningDecoration.push(iconRange);
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
    public static updateStepsHighlight(): void {
        const activeSVDiagnostic: SarifViewerVsCodeDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
        if (activeSVDiagnostic && activeSVDiagnostic.resultInfo.codeFlows !== undefined) {
            // for each visible editor add any of the codeflow locations that match it's Uri
            for (const editor of window.visibleTextEditors) {
                const decorations: DecorationOptions[] = [];
                const unimportantDecorations: DecorationOptions[] = [];
                for (const codeflow of activeSVDiagnostic.resultInfo.codeFlows) {
                    // For now we only support one threadFlow in the code flow
                    for (const step of codeflow.threads[0].steps) {
                        const decoration: DecorationOptions | undefined = CodeFlowDecorations.createHighlightDecoration(step, editor);
                        if (decoration) {
                            if (step.importance === "unimportant") {
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
    public static async updateAttachmentSelection(attachmentId: number, regionId: number): Promise<void> {
        const svDiagnostic: SarifViewerVsCodeDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
        if (svDiagnostic.rawResult && svDiagnostic.rawResult.attachments) {
            const attachment: sarif.Attachment | undefined = svDiagnostic.rawResult.attachments[attachmentId];
            if (attachment && attachment.regions) {
                const region: sarif.Region | undefined =  attachment.regions[regionId];
                if (region) {
                    const location: Location = svDiagnostic.resultInfo.attachments[attachmentId].regionsOfInterest[regionId];
                    const sarifPhysicalLocation: sarif.PhysicalLocation = {
                        artifactLocation: svDiagnostic.rawResult.attachments[attachmentId].artifactLocation,
                        region: region,
                    };

                    const sarifLocation: sarif.Location = { physicalLocation: sarifPhysicalLocation };

                    await CodeFlowDecorations.updateSelectionHighlight(location, sarifLocation);
                }
            }
        }
    }

    /**
     * Selects the next CodeFlow step
     */
    public static async selectNextCFStep(): Promise<void>  {
        if (CodeFlowDecorations.lastCodeFlowSelected) {
            const nextId: CodeFlowStepId = CodeFlowDecorations.lastCodeFlowSelected;
            nextId.stepId++;
            const codeFlows: CodeFlow[] = ExplorerController.Instance.activeSVDiagnostic.resultInfo.codeFlows;
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
            await CodeFlowDecorations.updateCodeFlowSelection(undefined, nextId);
            ExplorerController.Instance.setSelectedCodeFlow(`${nextId.cFId}_${nextId.tFId}_${nextId.stepId}`);
        } else {
            const activeDiag: SarifViewerDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
            if (activeDiag !== undefined && activeDiag.resultInfo !== undefined &&
                activeDiag.resultInfo.codeFlows !== undefined && activeDiag.resultInfo.codeFlows.length > 0) {
                const firstStepId: string = "0_0_0";
                await CodeFlowDecorations.updateCodeFlowSelection(firstStepId);
                ExplorerController.Instance.setSelectedCodeFlow(firstStepId);
            }
        }
    }

    /**
     * Selects the previous CodeFlow step
     */
    public static async selectPrevCFStep(): Promise<void> {
        if (CodeFlowDecorations.lastCodeFlowSelected) {
            const prevId: CodeFlowStepId = CodeFlowDecorations.lastCodeFlowSelected;
            prevId.stepId--;
            const codeFlows: CodeFlow[] = ExplorerController.Instance.activeSVDiagnostic.resultInfo.codeFlows;
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

            await CodeFlowDecorations.updateCodeFlowSelection(undefined, prevId);
            ExplorerController.Instance.setSelectedCodeFlow(`${prevId.cFId}_${prevId.tFId}_${prevId.stepId}`);
        } else {
            const activeDiag: SarifViewerDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
            if (activeDiag !== undefined && activeDiag.resultInfo !== undefined) {
                const codeflows: CodeFlow[] = activeDiag.resultInfo.codeFlows;
                if (codeflows !== undefined && codeflows.length > 0) {
                    const cFId: number = activeDiag.resultInfo.codeFlows.length - 1;
                    const tFId: number = activeDiag.resultInfo.codeFlows[cFId].threads.length - 1;
                    const stepId: number = activeDiag.resultInfo.codeFlows[cFId].threads[tFId].steps.length - 1;
                    const lastStepId: string = `${cFId}_${tFId}_${stepId}`;
                    await CodeFlowDecorations.updateCodeFlowSelection(lastStepId);
                    ExplorerController.Instance.setSelectedCodeFlow(lastStepId);
                }
            }
        }
    }

    /**
     * Updates the decoration that represents the currently selected Code Flow in the Explorer
     * Only pass in one value and leave the other undefined, if both values are undefined the value is cleared
     * @param idText text version of the id of the Code Flow, set to undefined if using id
     * @param idCFStep Id object of the Code Flow, set to undefined if using idText
     */
    public static async updateCodeFlowSelection(idText?: string, idCFStep?: CodeFlowStepId): Promise<void> {
        let id: CodeFlowStepId | undefined;
        if (idText) {
            id = CodeFlows.parseCodeFlowId(idText);
        } else if (idCFStep) {
            id = idCFStep;
        }

        if (id) {
            const diagnostic: SarifViewerDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
            if (!diagnostic.rawResult.codeFlows || !diagnostic.resultInfo.codeFlows) {
                return;
            }
            const resultInfoCodeFlow: CodeFlow | undefined = diagnostic.resultInfo.codeFlows[id.cFId];
            if (!resultInfoCodeFlow || !resultInfoCodeFlow.threads) {
                return;
            }

            const rawResultCodeFlow: sarif.CodeFlow | undefined = diagnostic.rawResult.codeFlows[id.cFId];
            if (!rawResultCodeFlow || !rawResultCodeFlow.threadFlows) {
                return;
            }

            const rawResultLocation: sarif.Location | undefined = rawResultCodeFlow.threadFlows[id.tFId].locations[id.stepId].location;
            if (!rawResultLocation) {
                return;
            }

            await  CodeFlowDecorations.updateSelectionHighlight(
                resultInfoCodeFlow.threads[id.tFId].steps[id.stepId].location,
                rawResultLocation);
            CodeFlowDecorations.lastCodeFlowSelected = id;
        }
    }

    /**
     * Updates the decoration that represents the currently selected Code Flow in the Explorer
     * @param location processed location to put the highlight at
     * @param sarifLocation raw sarif location used if location isn't mapped to get the user to try to map
     */
    public static async updateSelectionHighlight(location: Location, sarifLocation: sarif.Location): Promise<void> {
        const remappedLocation: Location | undefined = await LocationFactory.getOrRemap(
            location,
            sarifLocation,
            ExplorerController.Instance.activeSVDiagnostic.resultInfo.runId);

        if (remappedLocation && remappedLocation.mapped && remappedLocation.uri) {
            let locRange: Range | undefined = remappedLocation.range;
            if (!locRange) {
                return;
            }

            if (remappedLocation.endOfLine) {
                locRange = new Range(locRange.start, new Position(locRange.end.line - 1, Number.MAX_VALUE));
            }

            const textDocument: TextDocument = await  workspace.openTextDocument(remappedLocation.uri);
            const textEditor: TextEditor = await   window.showTextDocument(textDocument, ViewColumn.One, true);
            textEditor.setDecorations(CodeFlowDecorations.SelectionDecorationType, [{ range: locRange }]);
            textEditor.revealRange(locRange, TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    private static lastCodeFlowSelected: CodeFlowStepId | undefined;

    private static get GutterErrorDecorationType(): TextEditorDecorationType {
        if (!CodeFlowDecorations.gutterErrorDecorationType) {
            CodeFlowDecorations.gutterErrorDecorationType = window.createTextEditorDecorationType({
                gutterIconPath: Utilities.IconsPath + "error.svg",
            });
        }

        return CodeFlowDecorations.gutterErrorDecorationType;
    }
    private static gutterErrorDecorationType: TextEditorDecorationType;

    private static get GutterInfoDecorationType(): TextEditorDecorationType {
        if (!CodeFlowDecorations.gutterInfoDecorationType) {
            CodeFlowDecorations.gutterInfoDecorationType = window.createTextEditorDecorationType({
                gutterIconPath: Utilities.IconsPath + "info.svg",
            });
        }

        return CodeFlowDecorations.gutterInfoDecorationType;
    }
    private static gutterInfoDecorationType: TextEditorDecorationType;

    private static get GutterWarningDecorationType(): TextEditorDecorationType {
        if (!CodeFlowDecorations.gutterWarningDecorationType) {
            CodeFlowDecorations.gutterWarningDecorationType = window.createTextEditorDecorationType({
                gutterIconPath: Utilities.IconsPath + "warning.svg",
            });
        }

        return CodeFlowDecorations.gutterWarningDecorationType;
    }
    private static gutterWarningDecorationType: TextEditorDecorationType;

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
        dark: {
            borderColor: "white",
        },
        light: {
            borderColor: "black",
        },
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
    private static createHighlightDecoration(step: CodeFlowStep, editor: TextEditor): DecorationOptions | undefined {
        if (!step.location.uri ||
            !step.location.mapped ||
            !step.location.range ||
            step.location.uri.toString() !== editor.document.uri.toString()) {
            return undefined;
        }
        let stepRange: Range = step.location.range;

        if (step.location.endOfLine === true) {
            stepRange = new Range(stepRange.start, new Position(stepRange.end.line - 1, Number.MAX_VALUE));
        }

        let beforeDecoration: DecorationInstanceRenderOptions | undefined;
        if (step.beforeIcon) {
            const beforePath: Uri = Uri.file(step.beforeIcon);

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

        return {
            hoverMessage: `[CodeFlow] ${step.messageWithStep}`,
            range: stepRange,
            renderOptions: beforeDecoration,
        };
    }
}
