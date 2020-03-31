/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import { Range, Uri } from "vscode";
import { Location, Message, JsonMapping, JsonPointer, RunInfo } from "../common/Interfaces";
import { LogReader } from "../LogReader";
import { Utilities } from "../Utilities";
import { FileMapper } from "../FileMapper";

/**
 * Namespace that has the functions for processing (and transforming) the Sarif locations
 * a model used by the Web Panel (typically Range and URis used by vscode).
 */
export namespace LocationFactory {
    /**
     * Processes the passed in sarif location and creates a new Location
     * @param sarifLocation location from result in sarif file
     * @param runId used for mapping uribaseids
     */
    export async function create(fileMapper: FileMapper, runInfo: RunInfo, sarifLocation: sarif.Location, runId: number): Promise<Location> {
        const id: number | undefined = sarifLocation.id;
        const physLocation: sarif.PhysicalLocation | undefined = sarifLocation.physicalLocation;
        let uriBase: string | undefined;
        let uri: Uri | undefined;
        let mapped: boolean = false;
        let fileName: string | undefined;
        let parsedRange: { range: Range; endOfLine: boolean } | undefined;
        let message: Message | undefined;
        let logicalLocations: string[] | undefined;

        if (physLocation && physLocation.artifactLocation) {
            const artifactLocation: sarif.ArtifactLocation = physLocation.artifactLocation;
            uriBase = Utilities.getUriBase(runInfo, artifactLocation);

            const mappedUri: {mapped: boolean; uri?: Uri}  = await fileMapper.get(artifactLocation, runId, uriBase);
            mapped = mappedUri.mapped;

            uri = mappedUri.uri && Utilities.fixUriCasing(mappedUri.uri);

            // toString() is executed to create an external value for the webview's use
            if (uri) {
                uri.toString();
                fileName = uri.toString(true).substring(uri.toString(true).lastIndexOf("/") + 1);
            }
        }

        if (physLocation && physLocation.region) {
            parsedRange = LocationFactory.parseRange(physLocation.region);
            message = Utilities.parseSarifMessage(physLocation.region.message);
        }

        const logLocations: sarif.LogicalLocation[] | undefined = sarifLocation.logicalLocations;
        if (logLocations) {
            logicalLocations = [];
            for (const logLoc of logLocations) {
                if (logLoc.fullyQualifiedName) {
                    logicalLocations.push(logLoc.fullyQualifiedName);
                } else if (logLoc.name) {
                    logicalLocations.push(logLoc.name);
                }
            }
        }

        return {
            id,
            endOfLine: parsedRange?.endOfLine,
            fileName,
            logicalLocations,
            mapped,
            range: parsedRange?.range ?? new Range(0, 0, 0, 1),
            uri,
            uriBase,
            message,
            toJSON: Utilities.LocationToJson
        };
    }

    /**
     * Helper function returns the passed in location if mapped, if not mapped or undefined it asks the user
     * @param location processed Location of the file
     * @param sarifLocation raw sarif Location of the file
     * @param runId used for mapping uribaseids
     */
    export async function getOrRemap(fileMapper: FileMapper, runInfo: RunInfo, location: Location | undefined, sarifLocation: sarif.Location | undefined, runId: number): Promise<Location | undefined> {
        // If it's already mapped, then just return it.
        if (location && location.mapped) {
            return location;
        }

        // We can't remap a location without a uri base. (I think)
        if (!location || !location.uriBase) {
            return undefined;
        }

        if (!sarifLocation || !sarifLocation.physicalLocation) {
            return location;
        }

        const physLoc: sarif.PhysicalLocation = sarifLocation.physicalLocation;

        if (!physLoc.artifactLocation || !physLoc.artifactLocation.uri) {
            return location;
        }

        const uri: Uri = Utilities.combineUriWithUriBase(physLoc.artifactLocation.uri, location.uriBase);
        await fileMapper.getUserToChooseFile(uri, location.uriBase);
        return await LocationFactory.create(fileMapper, runInfo, sarifLocation, runId);
    }

    /**
     * Maps a Location to the File Location of a result in the SARIF file
     * @param sarifUri Uri of the SARIF document the result is in
     * @param runIndex the index of the run in the SARIF file
     * @param resultIndex the index of the result in the SARIF file
     */
    export function  mapToSarifFileLocation(logReader: LogReader, sarifUri: Uri, runIndex: number, resultIndex: number): Location | undefined {
        const sarifMapping: JsonMapping | undefined = logReader.sarifJSONMapping.get(sarifUri.toString());
        if (!sarifMapping) {
            return undefined;
        }

        const sarifLog: sarif.Log = sarifMapping.data;
        if (runIndex >= sarifLog.runs.length) {
            return undefined;
        }

        const sarifRun: sarif.Run = sarifLog.runs[runIndex];
        if (!sarifRun.results) {
            return undefined;
        }

        const result: sarif.Result = sarifRun.results[resultIndex];
        const locations: sarif.Location[] | undefined = result.locations;
        let resultPath: string = "/runs/" + runIndex + "/results/" + resultIndex;
        if (locations  && locations.length !== 0 && locations[0].physicalLocation) {
            resultPath = resultPath + "/locations/0/physicalLocation";
        } else if (result.analysisTarget !== undefined) {
            resultPath = resultPath + "/analysisTarget";
        }

        return LocationFactory.createLocationOfMapping(logReader, sarifUri, resultPath);
    }

    /**
     * Maps a Location to the top of the result in the SARIF file
     * @param sarifUri Uri of the SARIF document the result is in
     * @param runIndex the index of the run in the SARIF file
     * @param resultIndex the index of the result in the SARIF file
     */
    export function mapToSarifFileResult(logRader: LogReader, sarifUri: Uri, runIndex: number, resultIndex: number): Location | undefined {
        const resultPath: string = "/runs/" + runIndex + "/results/" + resultIndex;
        return LocationFactory.createLocationOfMapping(logRader, sarifUri, resultPath, true);
    }

    /**
     * Maps the resultPath to a Location object
     * @param sarifUri Uri of the SARIF document the result is in
     * @param resultPath the pointer to the JsonMapping
     * @param insertionPtr flag to set if you want the start position instead of the range, sets the end to the start
     */
    export function createLocationOfMapping(logRader: LogReader, sarifUri: Uri, resultPath: string, insertionPtr?: boolean): Location | undefined {
        const sarifMapping: JsonMapping | undefined = logRader.sarifJSONMapping.get(sarifUri.toString());
        if (!sarifMapping) {
            return undefined;
        }

        const locationMapping: JsonPointer = sarifMapping.pointers[resultPath];

        if (insertionPtr === true) {
            locationMapping.valueEnd = locationMapping.value;
        }

        const resultLocation: Location = {
            endOfLine: false,
            fileName: sarifUri.fsPath.substring(sarifUri.fsPath.lastIndexOf("\\") + 1),
            mapped: false,
            range: new Range(locationMapping.value.line, locationMapping.value.column,
                locationMapping.valueEnd.line, locationMapping.valueEnd.column),
            uri: sarifUri,
            toJSON: Utilities.LocationToJson
        };

        return resultLocation;
    }

    /**
     * Parses the range from the Region in the SARIF file
     * @param region region the result is located
     */
    export function  parseRange(region: sarif.Region): { range: Range; endOfLine: boolean } {
        let startline: number = 0;
        let startcol: number = 0;
        let endline: number = 0;
        let endcol: number = 1;
        let eol: boolean = false;

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
                startcol = region.charOffset;

                if (region.charLength !== undefined) {
                    endcol = region.charLength + region.charOffset;
                } else {
                    endcol = startcol;
                }
            }
        }

        return { range: new Range(startline, startcol, endline, endcol), endOfLine: eol };
    }
}
