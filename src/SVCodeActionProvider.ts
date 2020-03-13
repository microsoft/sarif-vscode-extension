/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
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
export class SVCodeActionProvider implements vscode.CodeActionProvider, vscode.Disposable {
    private isFirstCall = true;
    private disposables: vscode.Disposable[] = [];

    public constructor(private readonly explorerController: ExplorerController) {
        this.disposables.push(vscode.languages.registerCodeActionsProvider("*", this));
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        vscode.Disposable.from(...this.disposables).dispose();
        this.disposables = [];
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
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token?: vscode.CancellationToken): Promise<vscode.CodeAction[]> {
        const index: number = context.diagnostics.findIndex((x) => (<SarifViewerVsCodeDiagnostic>x).resultInfo !== undefined);
        if (!context.only && index !== -1) {
            const svDiagnostic: SarifViewerVsCodeDiagnostic = <SarifViewerVsCodeDiagnostic>context.diagnostics[index];
            if (svDiagnostic.source === "SARIFViewer") {
                // This diagnostic is the place holder for the problems panel limit message,
                // can possibly put logic here to allow for showing next set of diagnostics
            } else {
                if (this.isFirstCall) {
                    await vscode.commands.executeCommand(ExplorerController.ExplorerLaunchCommand);
                    this.isFirstCall = false;
                }

                const activeSVDiagnostic: SarifViewerVsCodeDiagnostic | undefined = this.explorerController.activeDiagnostic;
                if (!activeSVDiagnostic || activeSVDiagnostic !== svDiagnostic) {
                    this.explorerController.setActiveDiagnostic(svDiagnostic);
                    if (svDiagnostic.resultInfo.assignedLocation) {
                        await CodeFlowDecorations.updateSelectionHighlight(this.explorerController, svDiagnostic.resultInfo.assignedLocation, svDiagnostic.rawResult);
                    }
                    CodeFlowDecorations.updateStepsHighlight(this.explorerController);
                    CodeFlowDecorations.updateResultGutterIcon(this.explorerController);
                    await CodeFlowDecorations.updateCodeFlowSelection(this.explorerController);
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
    private getCodeActions(svDiagnostic: SarifViewerVsCodeDiagnostic): vscode.CodeAction[] {
        const rawLocations: sarif.Location[] | undefined = svDiagnostic.rawResult.locations;
        const actions: vscode.CodeAction[] = [];

        if ((!svDiagnostic.resultInfo.assignedLocation || !svDiagnostic.resultInfo.assignedLocation.mapped) && rawLocations) {
            const physicalLocation: sarif.PhysicalLocation | undefined = rawLocations[0].physicalLocation;

            if (physicalLocation && physicalLocation.artifactLocation) {
                const cmd: vscode.Command  = {
                    arguments: [physicalLocation.artifactLocation, svDiagnostic.resultInfo.runId],
                    command: FileMapper.MapCommand,
                    title: "Map To Source",
                };

                const action: vscode.CodeAction = {
                    command: cmd,
                    diagnostics: SVDiagnosticCollection.Instance.getAllUnmappedDiagnostics(),
                    kind: vscode.CodeActionKind.QuickFix,
                    title: "Map To Source",
                } ;

                actions.push(action);
            }
        }

        return actions;
    }
}
