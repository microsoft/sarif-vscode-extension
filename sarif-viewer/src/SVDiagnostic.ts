// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Diagnostic, DiagnosticSeverity } from "vscode";
import { ResultInfo } from "./ResultInfo";
import { ResultLocation } from "./ResultLocation";
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
        super(resultinfo.locations[0].location, resultinfo.message);
        this.severity = this.getSeverity(resultinfo.ruleDefaultLevel);
        this.code = SVDiagnostic.Code;
        this.runinfo = runinfo;
        this.resultInfo = resultinfo;
        this.rawResult = result;
        this.source = this.runinfo.toolName;

        this.updateMessage();
    }

    /**
     * Updates the location, range and updates the display message to no longer show unmapped
     * @param resultLocation Location the diagnostic has been remapped to
     */
    public remap(resultLocation: ResultLocation): void {
        this.resultInfo.locations[0] = resultLocation;
        this.range = this.resultInfo.locations[0].location;
        this.updateMessage();
    }

    /**
     * Prepends the message with the rule Id if available
     * And Unmapped if the result has not been mapped
     */
    public updateMessage(): void {
        this.message = this.resultInfo.message;

        if (this.resultInfo.ruleId !== "") {
            this.message = `[${this.resultInfo.ruleId}] ${this.message}`;
        }

        if (this.resultInfo.locations[0].notMapped) {
            this.message = `[Unmapped] ${this.message}`;
        }
    }

    /**
     * Translates the default level to a DiagnosticSeverity
     * @param defaultLvl default level for the rule in the sarif file
     */
    private getSeverity(defaultLvl: sarif.Rule.defaultLevel): DiagnosticSeverity {
        switch (defaultLvl) {
            case sarif.Rule.defaultLevel.warning:
                return DiagnosticSeverity.Warning;
            case sarif.Rule.defaultLevel.error:
                return DiagnosticSeverity.Error;
            case sarif.Rule.defaultLevel.note:
                return DiagnosticSeverity.Information;
            default:
                return DiagnosticSeverity.Warning;
        }
    }
}
