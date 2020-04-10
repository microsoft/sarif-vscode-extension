/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';
import { ResultInfo, RunInfo, Location, MapLocationToLocalPathOptions } from './common/Interfaces';
import * as sarif from 'sarif';

const sarifLevelToVsCodeSeverityMap: Map<sarif.Result.level, vscode.DiagnosticSeverity> = new Map<sarif.Result.level, vscode.DiagnosticSeverity>([
    [ 'error', vscode.DiagnosticSeverity.Error],
    [ 'none', vscode.DiagnosticSeverity.Information],
    [ 'note', vscode.DiagnosticSeverity.Information],
    [ 'warning', vscode.DiagnosticSeverity.Warning],
]);

/**
 * Translates the Result level to a DiagnosticSeverity
 * @param level severity level for the result in the sarif file
 */
function getSeverity(level: sarif.Result.level): vscode.DiagnosticSeverity {
    return sarifLevelToVsCodeSeverityMap.get(level) || vscode.DiagnosticSeverity.Warning;
}

/**
 * Contains the diagnostic information for a single "result" in a SARIF file.
 */
export class SarifViewerVsCodeDiagnostic extends vscode.Diagnostic {
    /**
     * Constructs a VSCode diagnostic for a single SARIF result.
     * @param runInfo The run the diagnostic belons to.
     * @param resultInfo The result the diagnostic belongs to.
     * @param rawResult The original SARIF result from the SARIF JSON file.
     * @param currentLocation The current location the diagnostic currently belongs to. This location can either be a location in the SARIF JSON file, or if mapped by the user, the actual file-system location of the result.
     */
    public constructor(
        public readonly runInfo: RunInfo,
        public readonly resultInfo: ResultInfo,
        public readonly rawResult: sarif.Result,
        private currentLocation: Location) {
        super(currentLocation.range, resultInfo.message.text || "No message", getSeverity(resultInfo.severityLevel));
        this.code = resultInfo.ruleId;
        this.source = resultInfo.runInfo.toolName || "Unknown tool";
    }

    /**
     * The current location the diagnostic currently belongs to. This location can either be a location in the SARIF JSON file, or if mapped by the user, the actual file-system location of the result.
     */
    public get location(): Location {
        return this.currentLocation;
    }

    /**
     * Updates the location of this diagnostic to a new location.
     * @param mappedLocation The location that has been mapped to a file on the local filesystem.
     */
    public updateToMappedLocation(mappedLocation: Location): void {
        if (!mappedLocation.mappedToLocalPath) {
            throw new Error("Only expect mapped locations");
        }

        this.currentLocation = mappedLocation;
        this.range = mappedLocation.range;
    }

    public async attemptToMapLocation(promptUser: MapLocationToLocalPathOptions): Promise<void> {
        if (!this.resultInfo.assignedLocation || this.resultInfo.assignedLocation.mappedToLocalPath) {
            return;
        }

        await this.resultInfo.assignedLocation.mapLocationToLocalPath(promptUser);
    }
}
