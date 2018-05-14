// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Diagnostic, DiagnosticSeverity } from "vscode";
import { CodeFlows } from "./CodeFlows";
import { ResultInfo } from "./ResultInfo";
import { RunInfo } from "./RunInfo";

/**
 * Object that is used to display a problem in the Problems panel
 * Extended with the information representing the SARIF result
 */
export class SVDiagnostic extends Diagnostic {

    public static readonly Code = "SARIFReader";

    public runinfo: RunInfo;
    public resultInfo: ResultInfo;
    public rawResult: sarif.Result;

    public constructor(runinfo: RunInfo, resultinfo: ResultInfo, result: sarif.Result) {
        super(resultinfo.assignedLocation.range, resultinfo.message.text);
        this.severity = this.getSeverity(resultinfo.severityLevel);
        this.code = SVDiagnostic.Code;
        this.runinfo = runinfo;
        this.resultInfo = resultinfo;
        this.rawResult = result;
        this.source = this.runinfo.toolName;

        this.updateMessage();
    }

    /**
     * Tries to remap the locations for this diagnostic
     */
    public async tryToRemapLocations(): Promise<boolean> {
        if (this.resultInfo.codeFlows !== undefined) {
            await CodeFlows.tryRemapCodeFlows(this.resultInfo.codeFlows, this.rawResult.codeFlows);
        }

        await ResultInfo.parseLocations(this.rawResult.relatedLocations).then((locations) => {
            for (const index in locations) {
                if (locations[index] !== undefined && this.resultInfo.relatedLocs[index] !== locations[index]) {
                    this.resultInfo.relatedLocs[index] = locations[index];
                }
            }
        });

        return ResultInfo.parseLocations(this.rawResult.locations).then((locations) => {
            for (const index in locations) {
                if (locations[index] !== undefined && this.resultInfo.locations[index] !== locations[index]) {
                    this.resultInfo.locations[index] = locations[index];
                }
            }

            // If first location is mapped but the assigned location is not mapped we need to remap the diagnostic
            const firstLocation = this.resultInfo.locations[0];
            if (firstLocation !== null && firstLocation.mapped && !this.resultInfo.assignedLocation.mapped) {
                this.resultInfo.assignedLocation = firstLocation;
                this.range = firstLocation.range;
                this.updateMessage();
                return Promise.resolve(true);
            } else {
                return Promise.resolve(false);
            }
        });
    }

    /**
     * Prepends the message with the rule Id if available
     * And Unmapped if the result has not been mapped
     */
    public updateMessage(): void {
        this.message = this.resultInfo.message.text;

        if (this.resultInfo.ruleId !== "") {
            this.message = `[${this.resultInfo.ruleId}] ${this.message}`;
        }

        if (!this.resultInfo.assignedLocation.mapped) {
            this.message = `[Unmapped] ${this.message}`;
        }
    }

    /**
     * Translates the Result level to a DiagnosticSeverity
     * @param level severity level for the result in the sarif file
     */
    private getSeverity(level: sarif.Result.level): DiagnosticSeverity {
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
}
