// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import {
    CancellationToken, CodeActionContext, CodeActionProvider, Command, commands, Disposable, languages, ProviderResult,
    Range, TextDocument,
} from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { SarifViewerDiagnostic } from "./common/Interfaces";
import { ExplorerController } from "./ExplorerController";
import { FileMapper } from "./FileMapper";
import { SVDiagnosticFactory } from "./SVDiagnosticFactory";

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
    public dispose() {
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
    public provideCodeActions(
        document: TextDocument,
        range: Range,
        context: CodeActionContext,
        token: CancellationToken): ProviderResult<Command[]> {
        const index = context.diagnostics.findIndex((x) => x.code === SVDiagnosticFactory.Code);
        if (index !== -1) {
            const svDiagnostic = context.diagnostics[index] as SarifViewerDiagnostic;
            if (svDiagnostic.source === "SARIFViewer") {
                // Currently diagnostic is the place holder for the 250 limit,
                // can possibly put logic here to allow for showing next set of diagnostics
            } else {
                if (this.isFirstCall) {
                    commands.executeCommand(ExplorerController.ExplorerLaunchCommand);
                    this.isFirstCall = false;
                }

                const activeSVDiagnostic = ExplorerController.Instance.activeSVDiagnostic;
                if (activeSVDiagnostic === undefined || activeSVDiagnostic !== svDiagnostic) {
                    ExplorerController.Instance.setActiveDiagnostic(svDiagnostic);
                    CodeFlowCodeLensProvider.Instance.triggerCodeLensRefresh();
                    CodeFlowDecorations.updateSelectionHighlight(svDiagnostic.resultInfo.assignedLocation, undefined);
                    CodeFlowDecorations.updateStepsHighlight();
                    CodeFlowDecorations.updateResultGutterIcon();
                    CodeFlowDecorations.updateCodeFlowSelection();
                }

                const actions = this.getCodeActions(svDiagnostic);

                return actions;
            }
        } else {
            return undefined;
        }
    }

    /**
     * Creates the set of code actions for the passed in Sarif Viewer Diagnostic
     * @param svDiagnostic the Sarif Viewer Diagnostic to create the code actions from
     */
    private getCodeActions(svDiagnostic: SarifViewerDiagnostic): any[] {
        const rawLocations = svDiagnostic.rawResult.locations;
        const actions = [];

        if (!svDiagnostic.resultInfo.assignedLocation.mapped && rawLocations !== undefined) {
            const physicalLocation = rawLocations[0].physicalLocation;
            if (physicalLocation !== undefined && physicalLocation.fileLocation !== undefined) {
                actions.push({
                    arguments: [physicalLocation.fileLocation.uri],
                    command: FileMapper.MapCommand,
                    title: "Map To Source",
                });
            }
        }

        return actions;
    }
}
