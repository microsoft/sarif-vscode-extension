/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';
import { ResultInfo, RunInfo, Location } from './common/Interfaces';
import * as sarif from 'sarif';
import { DiagnosticSeverity } from 'vscode';

const sarifLevelToVsCodeSeverityMap: Map<sarif.Result.level, DiagnosticSeverity> = new Map<sarif.Result.level, DiagnosticSeverity>([
    [ "error", DiagnosticSeverity.Error],
    [ "none", DiagnosticSeverity.Information],
    [ "note", DiagnosticSeverity.Information],
    [ "warning", DiagnosticSeverity.Warning],
]);

/**
 * Translates the Result level to a DiagnosticSeverity
 * @param level severity level for the result in the sarif file
 */
function getSeverity(level: sarif.Result.level): DiagnosticSeverity {
    return sarifLevelToVsCodeSeverityMap.get(level) || DiagnosticSeverity.Warning;
}

export class SarifViewerVsCodeDiagnostic extends vscode.Diagnostic {
    public constructor(
        public readonly runInfo: RunInfo,
        public readonly resultInfo: ResultInfo,
        public readonly rawResult: sarif.Result,
        public readonly location: Location) {
        super(location.range, resultInfo.message.text || "No message", getSeverity(resultInfo.severityLevel));
        this.code = resultInfo.ruleId;
        this.source = resultInfo.runInfo.toolName || "Unknown tool";
    }
}
