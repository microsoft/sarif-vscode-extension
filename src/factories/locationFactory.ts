/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import * as fs from "fs";
import { Range, Uri, Event } from "vscode";
import { Location, Message, JsonMapping, JsonPointer, RunInfo } from "../common/interfaces";
import { Utilities } from "../utilities";
import { FileMapper } from "../fileMapper";
import { EmbeddedContentFileSystemProvider } from "../embeddedContentFileSystemProvider";
import { BinaryContentRenderer } from "../binaryContentRenderer";

/**
 * Namespace that has the functions for processing (and transforming) the Sarif locations
 * a model used by the Web Panel (typically Range and URis used by vscode).
 */
export namespace LocationFactory {
    /**
     * Processes the passed in sarif location and creates a new Location
     * @param sarifLog The raw sarif log.
     * @param runInfo The run the location belongs to.
     * @param sarifLocation location from result in sarif file
     */
    export async function create(sarifLog: sarif.Log, runInfo: RunInfo, sarifLocation: sarif.Location): Promise<Location> {
        const id: number | undefined = sarifLocation.id;
        const physLocation: sarif.PhysicalLocation | undefined = sarifLocation.physicalLocation;
        let uriBase: string | undefined;
        let uri: Uri | undefined;
        let mappedToLocalPath: boolean = false;
        let fileName: string | undefined;
        let parsedRange: { range: Range; endOfLine: boolean } | undefined;
        let message: Message | undefined;
        let logicalLocations: string[] | undefined;

        if (physLocation && physLocation.artifactLocation && physLocation.artifactLocation.uri) {
            const artifactLocation: sarif.ArtifactLocation = physLocation.artifactLocation;
            uriBase = Utilities.getUriBase(runInfo, artifactLocation);
            uri = Utilities.combineUriWithUriBase(physLocation.artifactLocation.uri, uriBase);

            if (uri) {
                // Check for embedded content and create our embedded content URI if it is embedded.
                if (physLocation.artifactLocation.index !== undefined) {
                    fileName = uri.toString(true).substring(uri.toString(true).lastIndexOf('/') + 1);
                    const embeddedUri: Uri | undefined = EmbeddedContentFileSystemProvider.tryCreateUri(sarifLog, Uri.file(runInfo.sarifFileFullPath), fileName, runInfo.runIndex, physLocation.artifactLocation.index);
                    if (embeddedUri) {
                        uri = embeddedUri;
                        mappedToLocalPath = true;

                        // See if we can parse the range.
                        if (physLocation &&
                            physLocation.region) {
                                // In theory what we would do here is map the ranges based on each embedded content types as appropriate.
                                // For now let's just do this for the binary content as we render that as markdown.
                                // Note that the binary render does not do anything with the content for creating the range.
                                const binaryContentRenderer: BinaryContentRenderer | undefined = BinaryContentRenderer.tryCreateFromLog(sarifLog, runInfo.runIndex, physLocation.artifactLocation.index);
                                if (binaryContentRenderer) {
                                    if (physLocation.region.byteOffset !== undefined && physLocation.region.byteLength !== undefined) {
                                        parsedRange = {
                                        range: binaryContentRenderer.rangeFromOffsetAndLength(physLocation.region.byteOffset, physLocation.region.byteLength),
                                        endOfLine: false
                                    };
                                }
                            }
                        }
                    }
                }

                // If the URI is of file scheme, then we will try to fix the casing
                // because VSCode treats URIs as case sensitive and if the case
                // isn't correct can result in opening the same file twice (with different casing).
                // Also, we can treat the URI as "mapped to local path" if it exists locally.
                if (uri.isFile()) {
                    uri = Utilities.fixUriCasing(uri);
                    mappedToLocalPath = fs.existsSync(uri.fsPath);
                    fileName = uri.toString(true).substring(uri.toString(true).lastIndexOf('/') + 1);
                }
            }
        }

        if (!parsedRange) {
            if (physLocation && physLocation.region) {
                parsedRange = parseRange(physLocation.region);
                message = Utilities.parseSarifMessage(physLocation.region.message);
            }
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

        const location: Location = {
            locationInSarifFile: sarifLocation,
            id,
            endOfLine: parsedRange?.endOfLine,
            fileName,
            logicalLocations,
            mappedToLocalPath,
            range: parsedRange?.range ?? new Range(0, 0, 0, 1),
            uri,
            uriBase,
            message,
            toJSON: Utilities.LocationToJson,
            mapLocationToLocalPath: FileMapper.mapLocationToLocalPath,
            get locationMapped(): Event<Location> {
                // See this git-hub issue for discussion of this rule => https://github.com/palantir/tslint/issues/1544
                // tslint:disable-next-line: no-invalid-this
                return FileMapper.uriMappedForLocation.bind(this)();
            }
        };

        return location;
    }

    /**
     * Maps a Location to the top of the result in the SARIF file
     * @param sarifJSONMapping A map from a URI to pointers created during reading the SARIF file.
     * @param sarifUri Uri of the SARIF document the result is in
     * @param runIndex the index of the run in the SARIF file
     * @param resultIndex the index of the result in the SARIF file
     */
    export function mapToSarifFileResult(sarifJSONMapping: Map<string, JsonMapping>, sarifUri: Uri, runIndex: number, resultIndex: number): Location {
        const resultPath: string = `/runs/${runIndex}/results/${resultIndex}`;
        return createLocationOfMapping(sarifJSONMapping, sarifUri, resultPath, true);
    }

    /**
     * Maps the resultPath to a Location object
     * @param sarifJSONMapping A map from a URI to pointers created during reading the SARIF file.
     * @param sarifUri Uri of the SARIF document the result is in
     * @param resultPath the pointer to the JsonMapping
     * @param insertionPtr flag to set if you want the start position instead of the range, sets the end to the start
     */
    export function createLocationOfMapping(sarifJSONMapping: Map<string, JsonMapping>, sarifUri: Uri, resultPath: string, insertionPtr?: boolean): Location {
        const sarifMapping: JsonMapping | undefined = sarifJSONMapping.get(sarifUri.toString());
        if (!sarifMapping) {
            throw new Error('Expected to be able to find JSON path mapping');
        }

        const locationMapping: JsonPointer = sarifMapping.pointers[resultPath];

        if (insertionPtr === true) {
            locationMapping.valueEnd = locationMapping.value;
        }

        const resultLocation: Location = {
            endOfLine: false,
            fileName: sarifUri.fsPath.substring(sarifUri.fsPath.lastIndexOf('\\') + 1),
            mappedToLocalPath: false,
            range: new Range(locationMapping.value.line, locationMapping.value.column,
                locationMapping.valueEnd.line, locationMapping.valueEnd.column),
            uri: sarifUri,
            toJSON: Utilities.LocationToJson,
            mapLocationToLocalPath: FileMapper.mapLocationToLocalPath,
            get locationMapped(): Event<Location> {
                // See this git-hub issue for discussion of this rule => https://github.com/palantir/tslint/issues/1544
                // tslint:disable-next-line: no-invalid-this
                return FileMapper.uriMappedForLocation.bind(this)();
            }
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
                    endcol = Buffer.from(region.snippet.binary, 'base64').toString().length;
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

        return { range: new Range(startline, startcol, endline, endcol), endOfLine: eol };
    }
}
