// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ArtifactLocation, Location, Log, ReportingDescriptor, Result } from 'sarif';
import urlJoin from 'url-join';
import { URI } from 'vscode-uri';

type JsonLocation = { line: number, column: number } // Unused: pos
type JsonRange = { value: JsonLocation, valueEnd: JsonLocation } // Unused: key, keyEnd
export type JsonMap = Record<string, JsonRange>

export type ResultId = [string, number, number]

// The extended members we're adding here are prefixed with an underscore.
// Using this marker to easily get a sense of how much we're depending on these extended members.
// Once this design stabilities, these underscores will likely be removed as
// I don't see a need for them in the long term (after the design phase).
declare module 'sarif' {
    interface Log {
        _uri: string;
        _uriUpgraded?: string; // Only present if upgraded.
        _jsonMap?: JsonMap; // Only used by the "extension" side for navigating original SARIF sources. The "panel" side does not need this feature and thus does not use this field.
        _augmented: boolean;
        _distinct: Map<string, string>; // Technically per Run, practically doesn't matter right now.
    }

    interface Run {
        _index: number;
    }

    interface Result {
        _log: Log;
        _run: Run;
        _id: ResultId;
        _uri?: string;
        _uriContents?: string; // ArtifactContent. Do not use this uri for display.
        _relativeUri?: string;
        _region?: Region;
        _line: number;
        _rule?: ReportingDescriptor;
        _message: string; // '—' if empty.
        _markdown?: string;
        _suppression?: 'not suppressed' | 'suppressed';
        _fixed: true | undefined; // Used exclusively with CodeActions.
    }
}

// console.log(format(`'{0}' was not evaluated for check '{2}' as the analysis is not relevant based on observed metadata: {1}.`, ['x', 'y', 'z']))
function format(template: string | undefined, args?: string[]) {
    if (!template) return undefined;
    if (!args) return template;
    return template.replace(/{(\d+)}/g, (_, group) => args[group]);
}

export function mapDistinct(pairs: [string, string][]): Map<string, string> {
    const distinct = new Map<string, string | undefined>();
    for (const [key, value] of pairs) {
        if (distinct.has(key)) {
            const otherValue = distinct.get(key);
            if (value !== otherValue) distinct.set(key, undefined);
        } else {
            distinct.set(key, value);
        }
    }
    for (const [key, value] of distinct) {
        if (!value) distinct.delete(key);
    }
    return distinct as Map<string, string>;
}

export function augmentLog(log: Log, rules?: Map<string, ReportingDescriptor>) {
    if (log._augmented) return;
    log._augmented = true;
    const fileAndUris = [] as [string, string][];
    log.runs?.forEach((run, runIndex) => { // types.d.ts is wrong, per spec `runs` is allowed to be null.
        run._index = runIndex;

        // For `Run`s that lack `tool.driver.rules` we generate a `Rule` object on demand.
        // We intern these objects so they can be conveniently instance comparable elsewhere in the code.
        // If we don't do this, then the same ruleId may generate multiple `Rule` objects.
        // When instance comparing those `Rule` objects, they would appear to be different rules. We don't want that.
        const driverlessRules = rules ?? new Map<string, ReportingDescriptor>();
        function getDriverlessRule(id: string | undefined): ReportingDescriptor | undefined {
            if (!id) return undefined;
            if (!driverlessRules.has(id)) {
                driverlessRules.set(id, { id });
            }
            return driverlessRules.get(id)!;
        }

        let implicitBaseParts = undefined as string[] | undefined;
        run.results?.forEach((result, resultIndex) => {
            result._log = log;
            result._run = run;
            result._id = [log._uri, runIndex, resultIndex];

            const ploc = result.locations?.[0]?.physicalLocation;
            const [uri, uriContents] = parseArtifactLocation(result, ploc?.artifactLocation);
            result._uri = uri;
            result._uriContents = uriContents;
            {
                const parts = uri?.split('/');
                implicitBaseParts = // Base calc (inclusive of dash for now)
                    implicitBaseParts?.slice(0, Array.commonLength(implicitBaseParts, parts ?? []))
                    ?? parts;
                const file = parts?.pop();
                if (file && uri) {
                    fileAndUris.push([file, uri.replace(/^\//, '')]); // Normalize leading slashes.
                }
            }
            result._region = ploc?.region;
            result._line = result._region?.startLine ?? 0;

            result._rule = run.tool.driver.rules?.[result.ruleIndex ?? -1] // If result.ruleIndex is undefined, that's okay.
                ?? run.tool.driver.rules?.find(rule => rule.id === result.ruleId)
                ?? getDriverlessRule(result.ruleId);

            const message = result._rule?.messageStrings?.[result.message.id ?? -1] ?? result.message;
            result._message = format(message.text || result.message?.text, result.message.arguments) ?? '—';
            result._markdown = format(message.markdown || result.message?.markdown, result.message.arguments); // No '—', leave undefined if empty.

            result.level = effectiveLevel(result);
            result.baselineState = result.baselineState ?? 'new';
            result._suppression = !result.suppressions || result.suppressions.every(sup => sup.status === 'rejected')
                ? 'not suppressed'
                : 'suppressed';
        });

        const implicitBase = implicitBaseParts?.join('/')  ?? '';
        run.results?.forEach(result => {
            result._relativeUri = result._uri?.replace(implicitBase , '') ?? ''; // For grouping, Empty works more predictably than undefined
        });
    });
    log._distinct = mapDistinct(fileAndUris);
}

export function effectiveLevel(result: Result): Result.level {
    switch (result.kind) {
        case 'informational':
        case 'notApplicable':
        case 'pass':
            return 'note';
        case 'open':
        case 'review':
            return 'warning';
        case 'fail':
        default:
            return result.level ?? result._rule?.defaultConfiguration?.level ?? 'warning';
    }
}

/*
TfLoc
   location: Loc

Result
   locations: Loc[]

Loc
   Message
   PhyLoc
      ArtLoc: Uri, Index
      Region

Run.artifacts: Art[]
   location: ArtLoc
   contents: ArtCon
*/
export function parseLocation(result: Result, loc?: Location) {
    const message = loc?.message?.text;
    const [uri, uriContent] = parseArtifactLocation(result, loc?.physicalLocation?.artifactLocation);
    const region = loc?.physicalLocation?.region;
    return { message, uri, uriContent, region };
}

// Improve: `result` purely used for `_run.artifacts`.
export function parseArtifactLocation(result: Result, anyArtLoc: ArtifactLocation | undefined) {
    if (!anyArtLoc) return [undefined, undefined];
    const runArt = result._run.artifacts?.[anyArtLoc.index ?? -1];
    const runArtLoc = runArt?.location;
    const runArtCon = runArt?.contents;

    // Currently not supported: recursive resolution of uriBaseId.
    const uriBaseId = anyArtLoc.uriBaseId ?? runArtLoc?.uriBaseId;
    const uriBase = result._run.originalUriBaseIds?.[uriBaseId ?? '']?.uri ?? '';
    const relativeUri = anyArtLoc.uri ?? runArtLoc?.uri; // If index (§3.4.5) is absent, uri SHALL be present.

    // Convert possible relative URIs to absolute. Also serves to normalize leading slashes.
    // skipEncoding=true because otherwise 'file:///c:' incorrectly round-trips as 'file:///c%3A'.
    const normalizeUri = (uri: string) => URI.parse(uri, false /* allow relative URI */).toString(true /* skipEncoding */);
    const uri = relativeUri && normalizeUri(urlJoin(uriBase, relativeUri));

    // A shorter more transparent URI format would be:
    // `sarif://${encodeURIComponent(result._log._uri)}/${result._run._index}/${anyArtLoc.index}/${uri?.file ?? 'Untitled'}`
    // However between workspace.openTextDocument() and registerTextDocumentContentProvider/provideTextDocumentContent()
    // VS Code fails to maintain the authority value (possibly due to an encoding bug).
    const uriContents = runArtCon?.text || runArtCon?.binary
        ? encodeURI(`sarif:${encodeURIComponent(result._log._uri)}/${result._run._index}/${anyArtLoc.index}/${uri?.file ?? 'Untitled'}`)
        : undefined;
    return [uri, uriContents];
}

export function decodeFileUri(uriString: string) {
    const uri = URI.parse(uriString, false);
    return uri.scheme === 'file' ? uri.fsPath : uriString;
}

export type Visibility = 'visible' | false; // Undefined will not round-trip.

export const filtersRow: Record<string, Record<string, Visibility>> = {
    Level: {
        'Error': 'visible',
        'Warning': 'visible',
        'Note': 'visible',
        'None': 'visible',
    },
    Baseline: {
        'New': 'visible',
        'Unchanged': 'visible',
        'Updated': 'visible',
        'Absent': false,
    },
    Suppression: {
        'Not Suppressed': 'visible',
        'Suppressed': false,
    },
};

export const filtersColumn: Record<string, Record<string, Visibility>> = {
    Columns: {
        'Baseline': false,
        'Suppression': false,
        'Rule': false,
    },
};

export type CommandPanelToExtension = 'open' | 'closeLog' | 'closeAllLogs' | 'select' | 'selectLog' | 'setState';
export type CommandExtensionToPanel = 'select' | 'spliceLogs';
