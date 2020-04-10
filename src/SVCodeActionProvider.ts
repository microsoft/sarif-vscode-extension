/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */
import * as nls from 'vscode-nls';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as vscode from "vscode";
import { FileMapper } from "./fileMapper";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";
import { SVDiagnosticCollection } from "./svDiagnosticCollection";

/**
 * A codeactionprovider for the SARIF extension that handles updating the Explorer when the result focus changes
 * Also adds the Map to Source fix for the results that were not able to be mapped previously
 */
export class SVCodeActionProvider implements vscode.CodeActionProvider, vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    public constructor(private readonly diagnosticCollection: SVDiagnosticCollection) {
        this.disposables.push(vscode.languages.registerCodeActionsProvider('*', this));
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
        if (context.only || index === -1) {
            return [];
        }
        const svDiagnostic: SarifViewerVsCodeDiagnostic = <SarifViewerVsCodeDiagnostic>context.diagnostics[index];

        // This diagnostic with the source name of "SARIFViewer" is the place holder for the problems panel limit message,
        // can possibly put logic here to allow for showing next set of diagnostics
        if (svDiagnostic.source === 'SARIFViewer') {
            return [];
        }

        return this.getCodeActions(document.uri, svDiagnostic);
    }

    /**
     * Creates the set of code actions for the passed in Sarif Viewer Diagnostic
     * @param sarifFileUri The Sarif file for which to get the unmapped diagnostics from.
     * @param svDiagnostic the Sarif Viewer Diagnostic to create the code actions from
     */
    private getCodeActions(sarifFileUri: vscode.Uri, svDiagnostic: SarifViewerVsCodeDiagnostic): vscode.CodeAction[] {
        // If the location has already been mapped, then we don't need to map it again.
        if (svDiagnostic.location.mappedToLocalPath) {
            return [];
        }

        // If we don't have a location to map, then we obviously can't map it :)
        if (!svDiagnostic.resultInfo.assignedLocation) {
            return [];
        }

        const unmappedDiagnostics: SarifViewerVsCodeDiagnostic[] = this.diagnosticCollection.getAllUnmappedDiagnostics(sarifFileUri);
        if (unmappedDiagnostics.length === 0) {
            return [];
        }

        if (unmappedDiagnostics.find((unmappedDiagnostic) => unmappedDiagnostic === svDiagnostic) === undefined) {
            return [];
        }

        const cmd: vscode.Command  = {
            arguments: [svDiagnostic.resultInfo.assignedLocation],
            command: FileMapper.MapCommand,
            title: localize("command.mapToSource.title", "Map To Source"),
        };

        const action: vscode.CodeAction = {
            command: cmd,
            diagnostics:  unmappedDiagnostics,
            kind: vscode.CodeActionKind.QuickFix,
            title: localize("command.mapToSource.title", "Map To Source"),
        };

        return [action];
    }
}
