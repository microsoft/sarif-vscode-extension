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
export class Location {

    /**
     * Processes the passed in location and creates a new ResultLocation
     * Returns undefined if location or filelocation are not defined
     * @param sarifLocation location from result in sarif file
     */
    public static async create(sarifLocation: sarif.PhysicalLocation): Promise<Location> {
        const location = new Location();

        if (sarifLocation !== undefined && sarifLocation.fileLocation !== undefined) {
            const fileUri = Uri.parse(sarifLocation.fileLocation.uri);
            await FileMapper.Instance.get(fileUri).then((uri: Uri) => {
                if (uri !== null) {
                    location.uri = uri;
                    location.mapped = true;
                } else {
                    location.uri = fileUri;
                    location.mapped = false;
                }

                location.fileName = location.uri.toString(true).substring(
                    location.uri.toString(true).lastIndexOf("/") + 1);
            });
        } else {
            return Promise.resolve(undefined);
        }

        location.range = Location.parseRange(sarifLocation.region);

        return location;
    }

    /**
     * Maps the result back to the location in the SARIF file
     * @param sarifUri Uri of the SARIF document the result is in
     * @param runIndex the index of the run in the SARIF file
     * @param resultIndex the index of the result in the SARIF file
     */
    public static mapToSarifFile(sarifUri: Uri, runIndex: number, resultIndex: number): Location {
        const sarifMapping = LogReader.Instance.sarifJSONMapping.get(sarifUri.toString());
        const locations = sarifMapping.data.runs[runIndex].results[resultIndex].locations;
        let resultPath = "/runs/" + runIndex + "/results/" + resultIndex;
        if (locations !== undefined) {
            if (locations[0].physicalLocation !== undefined) {
                resultPath = resultPath + "/locations/0/physicalLocation";
            } else if (locations[0].analysisTarget !== undefined) {
                resultPath = resultPath + "/locations/0/analysisTarget";
            }
        }

        const locationMapping = sarifMapping.pointers[resultPath];
        const resultLocation = new Location();

        resultLocation.range = new Range(locationMapping.value.line, locationMapping.value.column,
            locationMapping.valueEnd.line, locationMapping.valueEnd.column);
        resultLocation.uri = sarifUri;
        resultLocation.fileName = sarifUri.fsPath.substring(resultLocation.uri.fsPath.lastIndexOf("\\") + 1);
        resultLocation.mapped = false;

        return resultLocation;
    }

    /**
     * Parses the range from the Region in the SARIF file
     * @param region region the result is located
     */
    private static parseRange(region: sarif.Region): Range {
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
                } else if (region.snippet !== undefined) {
                    if (region.snippet.text !== undefined) {
                        endcol = region.snippet.text.length - 2;
                    } else if (region.snippet.binary !== undefined) {
                        endcol = Buffer.from(region.snippet.binary, "base64").toString().length;
                    }
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

    public mapped: boolean;
    public range: Range;
    public uri: Uri;
    public fileName: string;

    private constructor() {
        this.range = new Range(0, 0, 0, 1);
        this.uri = null;
        this.fileName = "";
    }
}
