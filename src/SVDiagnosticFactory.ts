/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import { DiagnosticSeverity } from "vscode";
import { CodeFlows } from "./CodeFlows";
import { ResultInfo, Location, RunInfo } from "./common/Interfaces";
import { ResultInfoFactory } from "./ResultInfoFactory";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";
import { SarifViewerVsCodeDiagnostic } from "./SarifViewerDiagnostic";

/**
 * Object that is used to display a problem in the Problems panel
 * Extended with the information representing the SARIF result
 */
export class SVDiagnosticFactory {

    public static readonly Code = "SARIFReader";

    /**
     * Creates a new SarifViewerDiagnostic
     * @param resultInfo processed result info
     * @param rawResult sarif result info from the sarif file
     */
    public static create(diagnosticCollection: SVDiagnosticCollection, resultInfo: ResultInfo, rawResult: sarif.Result): SarifViewerVsCodeDiagnostic {
        if (!resultInfo.assignedLocation ||
            !resultInfo.assignedLocation.range ||
            !resultInfo.message.text) {
            throw new Error('Cannot represent a diagnostic without a range in the document and the diagnostic text to display to the user.');
        }

        const svDiagnostic: SarifViewerVsCodeDiagnostic = new SarifViewerVsCodeDiagnostic(resultInfo, rawResult, resultInfo.assignedLocation.range, resultInfo.message.text);
        svDiagnostic.severity = SVDiagnosticFactory.getSeverity(resultInfo.severityLevel);
        svDiagnostic.code = resultInfo.ruleId;

        const runInfo: RunInfo | undefined = diagnosticCollection.getRunInfo(resultInfo.runId);
        svDiagnostic.source = runInfo ? runInfo.toolName : "Unknown tool";

        svDiagnostic.message = SVDiagnosticFactory.updateMessage(svDiagnostic);

        return svDiagnostic;
    }

    /**
     * Tries to remap the locations for this diagnostic
     */
    public static async tryToRemapLocations(diagnostic: SarifViewerVsCodeDiagnostic): Promise<boolean> {
        const runId: number = diagnostic.resultInfo.runId;
        if (diagnostic.resultInfo.codeFlows && diagnostic.rawResult.codeFlows) {
            await CodeFlows.tryRemapCodeFlows(diagnostic.resultInfo.codeFlows, diagnostic.rawResult.codeFlows, runId);
        }

        if (diagnostic.rawResult.relatedLocations) {
            const parsedLocations: Location[] = await await ResultInfoFactory.parseLocations(diagnostic.rawResult.relatedLocations, runId);
            for (const index in parsedLocations) {
                if (parsedLocations[index] && diagnostic.resultInfo.relatedLocs[index] !== parsedLocations[index]) {
                    diagnostic.resultInfo.relatedLocs[index] = parsedLocations[index];
                }
            }
        }

        if (diagnostic.rawResult.locations) {
            const parsedLocations: Location[] = await ResultInfoFactory.parseLocations(diagnostic.rawResult.locations, runId);
            for (const index in parsedLocations) {
                if (parsedLocations[index] !== undefined && diagnostic.resultInfo.locations[index] !== parsedLocations[index]) {
                    diagnostic.resultInfo.locations[index] = parsedLocations[index];
                }
            }

            // If first location is mapped but the assigned location is not mapped we need to remap the diagnostic
            const firstLocation: Location = diagnostic.resultInfo.locations[0];
            if (firstLocation && firstLocation.mapped && (!diagnostic.resultInfo.assignedLocation || !diagnostic.resultInfo.assignedLocation.mapped)) {
                diagnostic.resultInfo.assignedLocation = firstLocation;
                if (firstLocation.range) {
                    diagnostic.range = firstLocation.range;
                }

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
    private static getSeverity(level: sarif.Result.level): DiagnosticSeverity {
        switch (level) {
            case "error":
                return DiagnosticSeverity.Error;
            case "none":
            case "note":
                return DiagnosticSeverity.Information;
            case "warning":
            default:
                return DiagnosticSeverity.Warning;
        }
    }

    /**
     * Prepends the message with the rule Id if available
     * And Unmapped if the result has not been mapped
     */
    private static updateMessage(diagnostic: SarifViewerVsCodeDiagnostic): string {
        let message: string = diagnostic.resultInfo.message.text || '';

        if (!diagnostic.resultInfo.assignedLocation || !diagnostic.resultInfo.assignedLocation.mapped) {
            message = `[Unmapped] ${message}`;
        }

        return message;
    }
}
