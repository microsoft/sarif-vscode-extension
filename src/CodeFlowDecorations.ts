/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";

import {
    commands, DecorationInstanceRenderOptions, DecorationOptions, DecorationRangeBehavior, DiagnosticSeverity, OverviewRulerLane,
    Position, Range, TextEditor, TextEditorDecorationType, TextEditorRevealType, Uri, ViewColumn, window, workspace, TextDocument, Disposable,
} from "vscode";
import { CodeFlowStep, CodeFlowStepId, Location, CodeFlow, WebviewMessage, LocationData } from "./common/Interfaces";
import { ExplorerController } from "./ExplorerController";
import { Utilities } from "./Utilities";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";
import { MessageType } from "./common/Enums";
import { CodeFlowFactory } from "./factories/CodeFlowFactory";
import { FileMapper } from "./FileMapper";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

const selectNextCFStepCommand: string = "extension.sarif.nextCodeFlowStep";
const selectPrevCFStepCommand: string = "extension.sarif.previousCodeFlowStep";
export const sendCFSelectionToExplorerCommand: string = "extension.sarif.SendCFSelectionToExplorer";

/**
 * Handles adding and updating the decorations for Code Flows of the current Result open in the Explorer
 */
export class CodeFlowDecorations implements Disposable {
    private disposables: Disposable[] = [];
    private activeDiagnostic: SarifViewerVsCodeDiagnostic | undefined;

    public constructor(private readonly explorerController: ExplorerController, diagnosticCollection: SVDiagnosticCollection) {
        this.disposables.push(window.onDidChangeVisibleTextEditors(this.onVisibleTextEditorsChanged.bind(this)));
        this.disposables.push(diagnosticCollection.onDidChangeActiveDiagnostic(this.onActiveDiagnosticChanged.bind(this)));
        this.disposables.push(explorerController.onWebViewMessage(this.onWebviewMessage.bind(this)));
        this.disposables.push(commands.registerCommand(selectPrevCFStepCommand, this.selectPrevCFStep.bind(this)));
        this.disposables.push(commands.registerCommand(selectNextCFStepCommand, this.selectNextCFStep.bind(this)));
        this.disposables.push(commands.registerCommand(sendCFSelectionToExplorerCommand, this.sendCFSelectionToExplorerCommand.bind(this)));
    }

    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * Updates the decorations when there is a change in the visible text editors
     */
    private async onVisibleTextEditorsChanged(): Promise<void> {
        this.lastCodeFlowSelected = undefined;
        await this.updateStepsHighlight();
        await this.updateResultGutterIcon();
    }

    private async onActiveDiagnosticChanged(diagnostic: SarifViewerVsCodeDiagnostic | undefined): Promise<void> {
        this.activeDiagnostic = diagnostic;
        this.lastCodeFlowSelected = undefined;
        await this.updateStepsHighlight();
        await this.updateResultGutterIcon();
    }

    /**
     * Updates the GutterIcon for the current active Diagnostic
     */
    public async updateResultGutterIcon(): Promise<void> {
        if (!this.activeDiagnostic || !this.activeDiagnostic.location.hasBeenMapped) {
            return;
        }

        for (const editor of window.visibleTextEditors) {
            // Attempt to map the result if it hasn't been mapped
            const diagLocation: Location = this.activeDiagnostic.location;
            if (!diagLocation.uri) {
                continue;
            }

            const mappedUri: Uri | undefined = this.activeDiagnostic.location.uri;
            if (!mappedUri) {
                continue;
            }

            if (mappedUri.toString() === editor.document.uri.toString()) {
                const errorDecoration: Range[] = [];
                const warningDecoration: Range[] = [];
                const infoDecoration: Range[] = [];
                const iconRange: Range = new Range(diagLocation.range.start, diagLocation.range.end);
                switch (this.activeDiagnostic.severity) {
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

    /**
     * Updates the decorations for the steps in the Code Flow tree
     */
    private async updateStepsHighlight(): Promise<void> {
        if (!this.activeDiagnostic || !this.activeDiagnostic.resultInfo.codeFlows) {
            return;
        }

        // for each visible editor add any of the codeflow locations that match it's Uri
        for (const editor of window.visibleTextEditors) {
            const decorations: DecorationOptions[] = [];
            const unimportantDecorations: DecorationOptions[] = [];
            for (const codeflow of this.activeDiagnostic.resultInfo.codeFlows) {
                // For now we only support one threadFlow in the code flow
                for (const step of codeflow.threads[0].steps) {
                    const decoration: DecorationOptions | undefined = await CodeFlowDecorations.createHighlightDecoration(step, editor);
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

    /**
     * Updates the selection to the selected attachment region
     * @param attachmentId Id of the attachment selected
     * @param regionId Id of the region selected
     */
    private async updateAttachmentSelection(attachmentId: number, regionId: number): Promise<void> {
        if (!this.activeDiagnostic || !this.activeDiagnostic.rawResult.attachments) {
            return;
        }

        const attachment: sarif.Attachment | undefined = this.activeDiagnostic.rawResult.attachments[attachmentId];
        if (attachment && attachment.regions) {
            const region: sarif.Region | undefined =  attachment.regions[regionId];
            if (region) {
                const location: Location = this.activeDiagnostic.resultInfo.attachments[attachmentId].regionsOfInterest[regionId];
                const sarifPhysicalLocation: sarif.PhysicalLocation = {
                    artifactLocation: this.activeDiagnostic.rawResult.attachments[attachmentId].artifactLocation,
                    region,
                };

                const sarifLocation: sarif.Location = { physicalLocation: sarifPhysicalLocation };

                await this.updateSelectionHighlight(location, sarifLocation);
            }
        }
    }

    /**
     * Selects the next CodeFlow step
     */
    private async selectNextCFStep(): Promise<void>  {
        if (!this.activeDiagnostic) {
            return;
        }

        if (this.lastCodeFlowSelected) {
            const nextId: CodeFlowStepId = this.lastCodeFlowSelected;
            nextId.stepId++;

            const codeFlows: CodeFlow[] = this.activeDiagnostic.resultInfo.codeFlows;
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
            await this.updateCodeFlowSelection(nextId);
            this.explorerController.setSelectedCodeFlow(`${nextId.cFId}_${nextId.tFId}_${nextId.stepId}`);
        } else {
            if (this.activeDiagnostic.resultInfo.codeFlows.length > 0) {
                const firstStepId: string = "0_0_0";
                await this.updateCodeFlowSelection(firstStepId);
                this.explorerController.setSelectedCodeFlow(firstStepId);
            }
        }
    }

    /**
     * Selects the previous CodeFlow step
     */
    private async selectPrevCFStep(): Promise<void> {
        if (!this.activeDiagnostic) {
            return;
        }

        if (this.lastCodeFlowSelected) {
            const prevId: CodeFlowStepId = this.lastCodeFlowSelected;
            prevId.stepId--;
            const codeFlows: CodeFlow[] = this.activeDiagnostic.resultInfo.codeFlows;
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

            await this.updateCodeFlowSelection(prevId);
            this.explorerController.setSelectedCodeFlow(`${prevId.cFId}_${prevId.tFId}_${prevId.stepId}`);
        } else {
            const codeflows: CodeFlow[] = this.activeDiagnostic.resultInfo.codeFlows;
            if (codeflows.length > 0) {
                const cFId: number = this.activeDiagnostic.resultInfo.codeFlows.length - 1;
                const tFId: number = this.activeDiagnostic.resultInfo.codeFlows[cFId].threads.length - 1;
                const stepId: number = this.activeDiagnostic.resultInfo.codeFlows[cFId].threads[tFId].steps.length - 1;
                const lastStepId: string = `${cFId}_${tFId}_${stepId}`;
                await this.updateCodeFlowSelection(lastStepId);
                this.explorerController.setSelectedCodeFlow(lastStepId);
            }
        }
    }

    /**
     * Updates the decoration that represents the currently selected Code Flow in the Explorer
     * Only pass in one value and leave the other undefined, if both values are undefined the value is cleared
     * @param idText text version of the id of the Code Flow, set to undefined if using id
     * @param idCFStep Id object of the Code Flow, set to undefined if using idText
     */
    private async updateCodeFlowSelection(cfStep: string | CodeFlowStepId): Promise<void> {
        const id: CodeFlowStepId | undefined  = typeof cfStep === 'string' ? CodeFlowFactory.parseCodeFlowId(cfStep) : cfStep;
        if (!id) {
            return;
        }

        this.lastCodeFlowSelected = id;

        const diagnostic: SarifViewerVsCodeDiagnostic | undefined = this.activeDiagnostic;
        if (!diagnostic) {
            return;
        }

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

        const resultInfoLocation: Location | undefined = resultInfoCodeFlow.threads[id.tFId].steps[id.stepId].location;
        if (!resultInfoLocation) {
            return;
        }

        await this.updateSelectionHighlight(resultInfoLocation, rawResultLocation);
    }

    /**
     * Updates the decoration that represents the currently selected Code Flow in the Explorer
     * @param location processed location to put the highlight at
     * @param sarifLocation raw sarif location used if location isn't mapped to get the user to try to map
     */
    private async updateSelectionHighlight(location: Location, sarifLocation?: sarif.Location): Promise<void> {
        if (!this.activeDiagnostic || !this.activeDiagnostic.location.hasBeenMapped) {
            return;
        }

        const mappedUri: Uri | undefined = this.activeDiagnostic.location.uri;
        if (!mappedUri) {
            return;
        }

        let locRange: Range | undefined = location.range;
        if (!locRange) {
            return;
        }

        if (location.endOfLine) {
            locRange = new Range(locRange.start, new Position(locRange.end.line - 1, Number.MAX_VALUE));
        }

        const textDocument: TextDocument = await workspace.openTextDocument(mappedUri);
        const textEditor: TextEditor = await window.showTextDocument(textDocument, ViewColumn.One, true);
        textEditor.setDecorations(CodeFlowDecorations.SelectionDecorationType, [{ range: locRange }]);
        textEditor.revealRange(locRange, TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private lastCodeFlowSelected: CodeFlowStepId | undefined;

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
    private static async createHighlightDecoration(step: CodeFlowStep, editor: TextEditor): Promise<DecorationOptions | undefined> {
        if (!step.location ||
            !step.location.uri) {
                return undefined;
        }

        const mappedUri: Uri | undefined = await step.location.mapLocationToLocalPath();
        if (!mappedUri ||
            mappedUri.toString() !== editor.document.uri.toString()) {
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

    private async onWebviewMessage(webViewMessage: WebviewMessage): Promise<void> {
        switch (webViewMessage.type) {
            case MessageType.AttachmentSelectionChange:
                const selectionId: string[] = (webViewMessage.data as string).split("_");
                if (selectionId.length !== 2) {
                    throw new Error('Selection id is incorrectly formatted');
                }

                const attachmentId: number = parseInt(selectionId[0], 10);
                if (selectionId.length > 1) {
                    await this.updateAttachmentSelection(attachmentId, parseInt(selectionId[1], 10));
                } else {
                    const diagnostic: SarifViewerVsCodeDiagnostic | undefined = this.activeDiagnostic;
                    if (!diagnostic) {
                        return;
                    }

                    const attachmentLocation: Location | undefined = diagnostic.resultInfo.attachments[attachmentId]?.location;
                    if (!attachmentLocation) {
                        return;
                    }

                    const mappedLocation: Uri | undefined = await attachmentLocation.mapLocationToLocalPath();
                    if (!mappedLocation) {
                        return;
                    }

                    await commands.executeCommand("vscode.open", mappedLocation, ViewColumn.One);
                }
                break;

            case MessageType.CodeFlowSelectionChange:
                await this.updateCodeFlowSelection(webViewMessage.data);
                break;

            case MessageType.SourceLinkClicked:
                const locData: LocationData = JSON.parse(webViewMessage.data);
                const location: Location = {
                    hasBeenMapped: true,
                    range: new Range(parseInt(locData.sLine, 10), parseInt(locData.sCol, 10),
                        parseInt(locData.eLine, 10), parseInt(locData.eCol, 10)),
                    uri: Uri.parse(locData.file),
                    toJSON: Utilities.LocationToJson,
                    mapLocationToLocalPath: FileMapper.mapLocationToLocalPath,
                    onLocationMapped: FileMapper.uriMappedForLocation
                };
                await this.updateSelectionHighlight(location, undefined);
                break;
        }
    }

    private async sendCFSelectionToExplorerCommand(id: string): Promise<void> {
        await this.updateCodeFlowSelection(id);
        this.explorerController.setSelectedCodeFlow(id);
    }
}
