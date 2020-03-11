/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

 import * as vscode from 'vscode';
import { ResultInfo, SarifViewerDiagnostic } from './common/Interfaces';
import { Result } from 'sarif';

export class SarifViewerVsCodeDiagnostic extends vscode.Diagnostic implements SarifViewerDiagnostic {
    public constructor(
        public readonly resultInfo: ResultInfo,
        public readonly rawResult: Result, range: vscode.Range,
        message: string,
        severity?: vscode.DiagnosticSeverity) {
        super(range, message, severity);
    }
}
