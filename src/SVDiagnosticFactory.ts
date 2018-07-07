// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { Diagnostic, DiagnosticSeverity } from "vscode";
import { CodeFlows } from "./CodeFlows";
import { ResultInfo, RunInfo, SarifViewerDiagnostic } from "./common/Interfaces";
import { sarif } from "./common/SARIFInterfaces";
import { ResultInfoFactory } from "./ResultInfoFactory";

/**
 * Object that is used to display a problem in the Problems panel
 * Extended with the information representing the SARIF result
 */
export class SVDiagnosticFactory {

    public static readonly Code = "SARIFReader";

    /**
     * Creates a new SarifViewerDiagnostic
     * @param runinfo processed run info
     * @param resultinfo processed result info
     * @param result sarif result info from the sarif file
     */
    public static create(runinfo: RunInfo, resultinfo: ResultInfo, result: sarif.Result): SarifViewerDiagnostic {
        const diagnostic = new Diagnostic(resultinfo.assignedLocation.range, resultinfo.message.text);
        const svDiagnostic = diagnostic as SarifViewerDiagnostic;
        svDiagnostic.severity = SVDiagnosticFactory.getSeverity(resultinfo.severityLevel);
        svDiagnostic.code = SVDiagnosticFactory.Code;
        svDiagnostic.runinfo = runinfo;
        svDiagnostic.resultInfo = resultinfo;
        svDiagnostic.rawResult = result;
        svDiagnostic.source = svDiagnostic.runinfo.toolName;

        svDiagnostic.message = SVDiagnosticFactory.updateMessage(svDiagnostic);

        return svDiagnostic;
    }

    /**
     * Tries to remap the locations for this diagnostic
     */
    public static async tryToRemapLocations(diagnostic: SarifViewerDiagnostic): Promise<boolean> {
        if (diagnostic.resultInfo.codeFlows !== undefined) {
            await CodeFlows.tryRemapCodeFlows(diagnostic.resultInfo.codeFlows, diagnostic.rawResult.codeFlows);
        }

        await ResultInfoFactory.parseLocations(diagnostic.rawResult.relatedLocations).then((locations) => {
            for (const index in locations) {
                if (locations[index] !== undefined && diagnostic.resultInfo.relatedLocs[index] !== locations[index]) {
                    diagnostic.resultInfo.relatedLocs[index] = locations[index];
                }
            }
        });

        return ResultInfoFactory.parseLocations(diagnostic.rawResult.locations).then((locations) => {
            for (const index in locations) {
                if (locations[index] !== undefined && diagnostic.resultInfo.locations[index] !== locations[index]) {
                    diagnostic.resultInfo.locations[index] = locations[index];
                }
            }

            // If first location is mapped but the assigned location is not mapped we need to remap the diagnostic
            const firstLocation = diagnostic.resultInfo.locations[0];
            if (firstLocation !== null && firstLocation.mapped && !diagnostic.resultInfo.assignedLocation.mapped) {
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
            case sarif.Result.level.error:
                return DiagnosticSeverity.Error;
            case sarif.Result.level.warning:
            case sarif.Result.level.open:
                return DiagnosticSeverity.Warning;
            case sarif.Result.level.note:
            case sarif.Result.level.notApplicable:
            case sarif.Result.level.pass:
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

        if (diagnostic.resultInfo.ruleId !== "") {
            message = `[${diagnostic.resultInfo.ruleId}] ${message}`;
        }

        if (!diagnostic.resultInfo.assignedLocation.mapped) {
            message = `[Unmapped] ${message}`;
        }

        return message;
    }
}
