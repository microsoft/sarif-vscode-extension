// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Range, Uri } from "vscode";
import { FileMapper } from "./FileMapper";
import { LogReader } from "./LogReader";

/**
 * Class that holds the processed location from a results location
 */
export class ResultLocation {

    /**
     * Processes the passed in location and creates a new ResultLocation
     * @param location location from result in sarif file
     * @param snippet snippet from the result, this is only used if it can't get enough information from the location
     */
    public static async create(location: sarif.PhysicalLocation, snippet: string): Promise<ResultLocation> {
        const resultLocation = new ResultLocation();

        if (location.uri !== undefined) {
            await FileMapper.Instance.get(location.uri).then((uri: Uri) => {
                if (uri !== null) {
                    resultLocation.uri = uri;
                    resultLocation.fileName = resultLocation.uri.fsPath.substring(
                        resultLocation.uri.fsPath.lastIndexOf("\\") + 1);
                } else {
                    return Promise.reject("uri not Mapped");
                }
            });
        } else {
            return Promise.reject("uri undefined");
        }

        resultLocation.location = ResultLocation.parseRange(location.region, snippet);

        return resultLocation;
    }

    /**
     * Maps the result back to the location in the SARIF file
     * @param sarifUri Uri of the SARIF document the result is in
     * @param runIndex the index of the run in the SARIF file
     * @param resultIndex the index of the result in the SARIF file
     */
    public static mapToSarifFile(sarifUri: Uri, runIndex: number, resultIndex: number): ResultLocation {
        const resultPath = "/runs/" + runIndex + "/results/" + resultIndex + "/locations/0/resultFile";
        const resultMapping = LogReader.Instance.sarifJSONMapping.get(sarifUri.toString()).pointers[resultPath];
        const resultLocation = new ResultLocation();

        resultLocation.location = new Range(resultMapping.value.line, resultMapping.value.column,
            resultMapping.valueEnd.line, resultMapping.valueEnd.column);
        resultLocation.uri = sarifUri;
        resultLocation.fileName = sarifUri.fsPath.substring(resultLocation.uri.fsPath.lastIndexOf("\\") + 1);
        resultLocation.notMapped = true;

        return resultLocation;
    }

    /**
     * Parses the range from the Region in the SARIF file
     * @param region region the result is located
     * @param snippet snippet from the result
     */
    private static parseRange(region: sarif.Region, snippet?: string): Range {
        let startline = 0;
        let startcol = 0;
        let endline = 0;
        let endcol = 1;

        if (region !== undefined) {
            if (region.startLine !== undefined) {
                startline = region.startLine;
                endline = startline;
                if (region.startColumn !== undefined) {
                    startcol = region.startColumn - 1;
                }

                if (region.length !== undefined) {
                    endcol = region.length + region.startColumn - 1;
                } else if (region.endLine !== undefined) {
                    endline = region.endLine;
                    if (region.endColumn !== undefined) {
                        endcol = region.endColumn;
                    } else if (endline === startline) {
                        endcol = startcol;
                    } else {
                        endcol = 1;
                    }
                } else if (region.endColumn !== undefined) {
                    endcol = region.endColumn;
                    endline = startline;
                } else if (snippet !== undefined) {
                    endcol = snippet.length - 2;
                }

                // change to be zero based for the vscode editor
                startline--;
                endline--;

                if (endcol < startcol && endline === startline) {
                    endline++;
                    endcol = 0;
                }
            }
        }

        return new Range(startline, startcol, endline, endcol);
    }

    public notMapped: boolean;
    public location: Range;
    public uri: Uri;
    public fileName: string;

    private constructor() {
        this.location = new Range(0, 0, 0, 1);
        this.uri = null;
        this.fileName = "";
    }
}
