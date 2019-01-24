// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Diagnostic, DiagnosticSeverity } from "vscode";
import { CodeFlows } from "./CodeFlows";
import { ResultInfo, SarifViewerDiagnostic } from "./common/Interfaces";
import { ResultInfoFactory } from "./ResultInfoFactory";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

/**
 * Object that is used to display a problem in the Problems panel
 * Extended with the information representing the SARIF result
 */
export class SVDiagnosticFactory {

    public static readonly Code = "SARIFReader";

    /**
     * Creates a new SarifViewerDiagnostic
     * @param resultinfo processed result info
     * @param result sarif result info from the sarif file
     */
    public static create(resultinfo: ResultInfo, result: sarif.Result): SarifViewerDiagnostic {
        const diagnostic = new Diagnostic(resultinfo.assignedLocation.range, resultinfo.message.text);
        const svDiagnostic = diagnostic as SarifViewerDiagnostic;
        svDiagnostic.severity = SVDiagnosticFactory.getSeverity(resultinfo.severityLevel);
        svDiagnostic.code = resultinfo.ruleId;
        svDiagnostic.resultInfo = resultinfo;
        svDiagnostic.rawResult = result;
        svDiagnostic.source = SVDiagnosticCollection.Instance.getRunInfo(resultinfo.runId).toolName;

        svDiagnostic.message = SVDiagnosticFactory.updateMessage(svDiagnostic);

        return svDiagnostic;
    }

    /**
     * Tries to remap the locations for this diagnostic
     */
    public static async tryToRemapLocations(diagnostic: SarifViewerDiagnostic): Promise<boolean> {
        const runId = diagnostic.resultInfo.runId;
        if (diagnostic.resultInfo.codeFlows !== undefined) {
            await CodeFlows.tryRemapCodeFlows(diagnostic.resultInfo.codeFlows, diagnostic.rawResult.codeFlows, runId);
        }

        await ResultInfoFactory.parseLocations(diagnostic.rawResult.relatedLocations, runId).then((locations) => {
            for (const index in locations) {
                if (locations[index] !== undefined && diagnostic.resultInfo.relatedLocs[index] !== locations[index]) {
                    diagnostic.resultInfo.relatedLocs[index] = locations[index];
                }
            }
        });

        return ResultInfoFactory.parseLocations(diagnostic.rawResult.locations, runId).then((locations) => {
            for (const index in locations) {
                if (locations[index] !== undefined && diagnostic.resultInfo.locations[index] !== locations[index]) {
                    diagnostic.resultInfo.locations[index] = locations[index];
                }
            }

            // If first location is mapped but the assigned location is not mapped we need to remap the diagnostic
            const firstLocation = diagnostic.resultInfo.locations[0];
            if (firstLocation !== undefined && firstLocation.mapped && !diagnostic.resultInfo.assignedLocation.mapped) {
                diagnostic.resultInfo.assignedLocation = firstLocation;
                diagnostic.range = firstLocation.range;
                diagnostic.message = SVDiagnosticFactory.updateMessage(diagnostic);
                return Promise.resolve(true);
            } else {
                return Promise.resolve(false);
            }
        });
    }

    /**
     * Translates the Result level to a DiagnosticSeverity
     * @param level severity level for the result in the sarif file
     */
    private static getSeverity(level: sarif.Result.level): DiagnosticSeverity {
        switch (level) {
            case "error":
                return DiagnosticSeverity.Error;
            case "warning":
            case "open":
                return DiagnosticSeverity.Warning;
            case "note":
            case "notApplicable":
            case "pass":
                return DiagnosticSeverity.Information;
            default:
                return DiagnosticSeverity.Warning;
        }
    }

    /**
     * Prepends the message with the rule Id if available
     * And Unmapped if the result has not been mapped
     */
    private static updateMessage(diagnostic: SarifViewerDiagnostic): string {
        let message = diagnostic.resultInfo.message.text;

        if (!diagnostic.resultInfo.assignedLocation.mapped) {
            message = `[Unmapped] ${message}`;
        }

        return message;
    }
}
