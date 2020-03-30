/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import { ResultInfoFactory } from "./ResultInfoFactory";
import { CodeFlowFactory } from  "./CodeFlowFactory";
import { DiagnosticSeverity } from "vscode";
import { ResultInfo, Location, RunInfo } from "../common/Interfaces";
import { SarifViewerVsCodeDiagnostic } from "../SarifViewerDiagnostic";
import { ExplorerController } from "../ExplorerController";

const sarifLevelToVsCodeSeverityMap: Map<sarif.Result.level, DiagnosticSeverity> = new Map<sarif.Result.level, DiagnosticSeverity>([
    [ "error", DiagnosticSeverity.Error],
    [ "none", DiagnosticSeverity.Information],
    [ "note", DiagnosticSeverity.Information],
    [ "warning", DiagnosticSeverity.Warning],
]);

/**
 * Namespace that has the functions for processing (and transforming) the Sarif result into a VSCode diagnostic.
 */
export namespace SVDiagnosticFactory {

    /**
     * Creates a new SarifViewerDiagnostic
     * @param resultInfo processed result info
     * @param rawResult sarif result info from the sarif file
     */
    export function create(runInfo: RunInfo, resultInfo: ResultInfo, rawResult: sarif.Result): SarifViewerVsCodeDiagnostic {
        if (!resultInfo.assignedLocation ||
            !resultInfo.message.text) {
            throw new Error('Cannot represent a diagnostic without a range in the document and the diagnostic text to display to the user.');
        }

        const svDiagnostic: SarifViewerVsCodeDiagnostic = new SarifViewerVsCodeDiagnostic(runInfo, resultInfo, rawResult, resultInfo.assignedLocation.range, resultInfo.message.text);
        svDiagnostic.severity = SVDiagnosticFactory.getSeverity(resultInfo.severityLevel);
        svDiagnostic.code = resultInfo.ruleId;
        svDiagnostic.source = runInfo.toolName || "Unknown tool";

        svDiagnostic.message = SVDiagnosticFactory.updateMessage(svDiagnostic);

        return svDiagnostic;
    }

    /**
     * Tries to remap the locations for this diagnostic
     */
    export async function tryToRemapLocations(explorerController: ExplorerController, diagnostic: SarifViewerVsCodeDiagnostic): Promise<boolean> {
        const runId: number = diagnostic.resultInfo.runId;
        if (diagnostic.resultInfo.codeFlows && diagnostic.rawResult.codeFlows) {
            await CodeFlowFactory.tryRemapCodeFlows(explorerController, diagnostic.resultInfo.codeFlows, diagnostic.rawResult.codeFlows, runId);
        }

        if (diagnostic.rawResult.relatedLocations) {
            const parsedLocations: Location[] = await ResultInfoFactory.parseLocations(explorerController, diagnostic.rawResult.relatedLocations, runId);
            for (const index in parsedLocations) {
                if (parsedLocations[index] && diagnostic.resultInfo.relatedLocs[index] !== parsedLocations[index]) {
                    diagnostic.resultInfo.relatedLocs[index] = parsedLocations[index];
                }
            }
        }

        if (diagnostic.rawResult.locations) {
            const parsedLocations: Location[] = await ResultInfoFactory.parseLocations(explorerController, diagnostic.rawResult.locations, runId);
            for (const index in parsedLocations) {
                if (parsedLocations[index] !== undefined && diagnostic.resultInfo.locations[index] !== parsedLocations[index]) {
                    diagnostic.resultInfo.locations[index] = parsedLocations[index];
                }
            }

            // If first location is mapped but the assigned location is not mapped we need to remap the diagnostic
            const firstLocation: Location = diagnostic.resultInfo.locations[0];
            if (firstLocation && firstLocation.mapped && (!diagnostic.resultInfo.assignedLocation || !diagnostic.resultInfo.assignedLocation.mapped)) {
                diagnostic.resultInfo.assignedLocation = firstLocation;
                diagnostic.range = firstLocation.range;

                diagnostic.message = SVDiagnosticFactory.updateMessage(diagnostic);
                return true;
            }
        }

        return false;
    }

    /**
     * Translates the Result level to a DiagnosticSeverity
     * @param level severity level for the result in the sarif file
     */
    export function getSeverity(level: sarif.Result.level): DiagnosticSeverity {
        return sarifLevelToVsCodeSeverityMap.get(level) || DiagnosticSeverity.Warning;
    }

    /**
     * Prepends the message with the rule Id if available
     * And Unmapped if the result has not been mapped
     */
    export function updateMessage(diagnostic: SarifViewerVsCodeDiagnostic): string {
        let message: string = diagnostic.resultInfo.message.text || '';

        if (!diagnostic.resultInfo.assignedLocation || !diagnostic.resultInfo.assignedLocation.mapped) {
            message = `[Unmapped] ${message}`;
        }

        return message;
    }
}
