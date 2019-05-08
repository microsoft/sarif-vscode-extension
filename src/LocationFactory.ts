// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Range, Uri } from "vscode";
import { Location } from "./common/Interfaces";
import { FileMapper } from "./FileMapper";
import { LogReader } from "./LogReader";
import { Utilities } from "./Utilities";

/**
 * Class that processes and creates a location object from a results physicallocation
 */
export class LocationFactory {

    /**
     * Processes the passed in location and creates a new ResultLocation
     * Returns undefined if location or filelocation are not defined
     * @param sarifLocation location from result in sarif file
     * @param runId used for mapping uribaseids
     * @param id location Id
     */
    public static async create(sarifLocation: sarif.PhysicalLocation, runId: number, id?: number): Promise<Location> {
        if (sarifLocation === undefined || sarifLocation.artifactLocation === undefined) {
            return Promise.resolve(undefined);
        }

        const location = {
            endOfLine: false,
            fileName: "",
            range: new Range(0, 0, 0, 1),
            uri: null,
        } as Location;

        location.id = id;

        const artifactLocation = sarifLocation.artifactLocation;
        location.uriBase = Utilities.getUriBase(artifactLocation, runId);

        await FileMapper.Instance.get(artifactLocation, runId, location.uriBase).then((uri: Uri) => {
            if (uri !== null) {
                location.uri = uri;
                location.mapped = true;
            } else {
                location.uri = Utilities.combineUriWithUriBase(artifactLocation.uri, location.uriBase);
                location.uri.toString();
                location.mapped = false;
            }

            location.fileName = location.uri.toString(true).substring(
                location.uri.toString(true).lastIndexOf("/") + 1);
        });

        if (sarifLocation.region !== undefined) {
            const parsedRange = LocationFactory.parseRange(sarifLocation.region);
            location.range = parsedRange.range;
            location.endOfLine = parsedRange.endOfLine;
            location.message = Utilities.parseSarifMessage(sarifLocation.region.message);
        }

        return location;
    }

    /**
     * Helper function returns the passed in location if mapped, if not mapped or undefined it asks the user
     * @param location processed Location of the file
     * @param sarifLocation raw sarif Location of the file
     * @param runId used for mapping uribaseids
     */
    public static async getOrRemap(location: Location, sarifLocation: sarif.Location, runId: number) {
        if (location === undefined || !location.mapped) {
            if (sarifLocation !== undefined && sarifLocation.physicalLocation !== undefined) {
                const physLoc = sarifLocation.physicalLocation;
                const uri = Utilities.combineUriWithUriBase(physLoc.artifactLocation.uri, location.uriBase);
                await FileMapper.Instance.getUserToChooseFile(uri, location.uriBase).then(() => {
                    return LocationFactory.create(physLoc, runId, sarifLocation.id);
                }).then((remappedLocation) => {
                    location = remappedLocation;
                });
            }
        }

        return location;
    }

    /**
     * Maps a Location to the File Location of a result in the SARIF file
     * @param sarifUri Uri of the SARIF document the result is in
     * @param runIndex the index of the run in the SARIF file
     * @param resultIndex the index of the result in the SARIF file
     */
    public static mapToSarifFileLocation(sarifUri: Uri, runIndex: number, resultIndex: number): Location {
        const sarifMapping = LogReader.Instance.sarifJSONMapping.get(sarifUri.toString());
        const result = sarifMapping.data.runs[runIndex].results[resultIndex];
        const locations = result.locations;
        let resultPath = "/runs/" + runIndex + "/results/" + resultIndex;
        if (locations !== undefined && locations[0].physicalLocation !== undefined) {
            resultPath = resultPath + "/locations/0/physicalLocation";
        } else if (result.analysisTarget !== undefined) {
            resultPath = resultPath + "/analysisTarget";
        }

        return LocationFactory.createLocationOfMapping(sarifUri, resultPath);
    }

    /**
     * Maps a Location to the top of the result in the SARIF file
     * @param sarifUri Uri of the SARIF document the result is in
     * @param runIndex the index of the run in the SARIF file
     * @param resultIndex the index of the result in the SARIF file
     */
    public static mapToSarifFileResult(sarifUri: Uri, runIndex: number, resultIndex: number): Location {
        const resultPath = "/runs/" + runIndex + "/results/" + resultIndex;
        return LocationFactory.createLocationOfMapping(sarifUri, resultPath, true);
    }

    /**
     * Maps the resultPath to a Location object
     * @param sarifUri Uri of the SARIF document the result is in
     * @param resultPath the pointer to the JsonMapping
     * @param insertionPtr flag to set if you want the start position instead of the range, sets the end to the start
     */
    public static createLocationOfMapping(sarifUri: Uri, resultPath: string, insertionPtr?: boolean): Location {
        const sarifMapping = LogReader.Instance.sarifJSONMapping.get(sarifUri.toString());
        const locationMapping = sarifMapping.pointers[resultPath];
        if (insertionPtr === true) {
            locationMapping.valueEnd = locationMapping.value;
        }

        const resultLocation = {
            endOfLine: false,
            fileName: sarifUri.fsPath.substring(sarifUri.fsPath.lastIndexOf("\\") + 1),
            mapped: false,
            range: new Range(locationMapping.value.line, locationMapping.value.column,
                locationMapping.valueEnd.line, locationMapping.valueEnd.column),
            uri: sarifUri,
        } as Location;

        return resultLocation;
    }

    /**
     * Parses the range from the Region in the SARIF file
     * @param region region the result is located
     */
    public static parseRange(region: sarif.Region): { range: Range, endOfLine: boolean } {
        let startline = 0;
        let startcol = 0;
        let endline = 0;
        let endcol = 1;
        let eol = false;

        if (region !== undefined) {
            if (region.startLine !== undefined) {
                startline = region.startLine - 1;
                if (region.startColumn !== undefined) {
                    startcol = region.startColumn - 1;
                }

                if (region.endLine !== undefined) {
                    endline = region.endLine - 1;
                } else {
                    endline = startline;
                }

                if (region.endColumn !== undefined) {
                    endcol = region.endColumn - 1;
                } else if (region.snippet !== undefined) {
                    if (region.snippet.text !== undefined) {
                        endcol = region.snippet.text.length - 2;
                    } else if (region.snippet.binary !== undefined) {
                        endcol = Buffer.from(region.snippet.binary, "base64").toString().length;
                    }
                } else {
                    endline++;
                    endcol = 0;
                    eol = true;
                }
            } else if (region.charOffset !== undefined) {
                startline = 0;
                startcol = region.charOffset - 1;

                if (region.charLength !== undefined) {
                    endcol = region.charLength + region.charOffset - 1;
                } else {
                    endcol = startcol;
                }
            }
        }

        return { range: new Range(startline, startcol, endline, endcol), endOfLine: eol };
    }
}
