/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import {
    CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, Command, commands, Disposable,
    languages, Range, TextDocument,
} from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { ExplorerController } from "./ExplorerController";
import { FileMapper } from "./FileMapper";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";
import * as sarif from 'sarif';

/**
 * A codeactionprovider for the SARIF extension that handles updating the Explorer when the result focus changes
 * Also adds the Map to Source fix for the results that were not able to be mapped previously
 */
export class SVCodeActionProvider implements CodeActionProvider {
    private static instance: SVCodeActionProvider;

    private actionProvider: Disposable;
    private isFirstCall = true;

    private constructor() {
        this.actionProvider = languages.registerCodeActionsProvider("*", this);
    }

    static get Instance(): SVCodeActionProvider {
        if (SVCodeActionProvider.instance === undefined) {
            SVCodeActionProvider.instance = new SVCodeActionProvider();
        }

        return SVCodeActionProvider.instance;
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        this.actionProvider.dispose();
    }

    /**
     * Gets called when focus gets put into an issue in the source files. This checks if it's one of our diagnostics
     * then it will update the explorer with the new diagnostic
     * If the result hasn't been mapped it will add a Map to Source option in the fixs tool
     * @param document The document in which the command was invoked.
     * @param range The range for which the command was invoked.
     * @param context Context carrying additional information, this has the SVDiagnostic with our result payload.
     * @param token A cancellation token.
     */
    public async provideCodeActions(
        document: TextDocument,
        range: Range,
        context: CodeActionContext,
        token: CancellationToken): Promise<CodeAction[]> {
        const index: number = context.diagnostics.findIndex((x) => (<SarifViewerVsCodeDiagnostic>x).resultInfo !== undefined);
        if (!context.only && index !== -1) {
            const svDiagnostic: SarifViewerVsCodeDiagnostic = <SarifViewerVsCodeDiagnostic>context.diagnostics[index];
            if (svDiagnostic.source === "SARIFViewer") {
                // This diagnostic is the place holder for the problems panel limit message,
                // can possibly put logic here to allow for showing next set of diagnostics
            } else {
                if (this.isFirstCall) {
                    await commands.executeCommand(ExplorerController.ExplorerLaunchCommand);
                    this.isFirstCall = false;
                }

                const activeSVDiagnostic: SarifViewerVsCodeDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
                if (activeSVDiagnostic === undefined || activeSVDiagnostic !== svDiagnostic) {
                    ExplorerController.Instance.setActiveDiagnostic(svDiagnostic);
                    CodeFlowCodeLensProvider.Instance.triggerCodeLensRefresh();
                    await CodeFlowDecorations.updateSelectionHighlight(svDiagnostic.resultInfo.assignedLocation, svDiagnostic.rawResult);
                    CodeFlowDecorations.updateStepsHighlight();
                    CodeFlowDecorations.updateResultGutterIcon();
                    await CodeFlowDecorations.updateCodeFlowSelection();
                }

                return this.getCodeActions(svDiagnostic);
            }
        }

        return [];
    }

    /**
     * Creates the set of code actions for the passed in Sarif Viewer Diagnostic
     * @param svDiagnostic the Sarif Viewer Diagnostic to create the code actions from
     */
    private getCodeActions(svDiagnostic: SarifViewerVsCodeDiagnostic): CodeAction[] {
        const rawLocations: sarif.Location[] | undefined = svDiagnostic.rawResult.locations;
        const actions: CodeAction[] = [];

        if (!svDiagnostic.resultInfo.assignedLocation.mapped && rawLocations) {
            const physicalLocation: sarif.PhysicalLocation | undefined = rawLocations[0].physicalLocation;

            if (physicalLocation && physicalLocation.artifactLocation) {
                const cmd: Command  = {
                    arguments: [physicalLocation.artifactLocation, svDiagnostic.resultInfo.runId],
                    command: FileMapper.MapCommand,
                    title: "Map To Source",
                };

                const action: CodeAction = {
                    command: cmd,
                    diagnostics: SVDiagnosticCollection.Instance.getAllUnmappedDiagnostics(),
                    kind: CodeActionKind.QuickFix,
                    title: "Map To Source",
                } ;

                actions.push(action);
            }
        }

        return actions;
    }
}
