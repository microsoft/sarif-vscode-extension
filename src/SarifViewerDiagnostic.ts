/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

 import * as vscode from 'vscode';
import { ResultInfo, RunInfo } from './common/Interfaces';
import { Result } from 'sarif';

export class SarifViewerVsCodeDiagnostic extends vscode.Diagnostic implements vscode.Diagnostic {
    public constructor(
        public readonly runInfo: RunInfo,
        public readonly resultInfo: ResultInfo,
        public readonly rawResult: Result,
        range: vscode.Range,
        message: string,
        severity?: vscode.DiagnosticSeverity) {
        super(range, message, severity);
    }
}
