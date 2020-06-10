// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ArtifactLocation, Log, Location, Region, Result } from 'sarif';

type JsonLocation = { line: number, column: number } // Unused: pos
type JsonRange = { value: JsonLocation, valueEnd: JsonLocation } // Unused: key, keyEnd
export type JsonMap = Record<string, JsonRange>

export type ResultId = [string, number, number]
type _RegionBytes = [number, number] // byteOffset, byteLength
type _RegionStartEndLineCol = [number, number, number, number] // start line, start col, end line, end col
export type _Region
	= number // single line
	| _RegionBytes
	| _RegionStartEndLineCol

// The extended members we're adding here are prefixed with an underscore.
// Using this marker to easily get a sense of how much we're depending on these extended members.
// Once this design stabilities, these underscores will likely be removed as
// I don't see a need for them in the long term (after the design phase).
declare module 'sarif' {
	interface Log {
		_uri: string
		_uriUpgraded?: string
		_jsonMap?: JsonMap
		_augmented?: boolean
		_distinct: Map<string, string> // Technically per Run, practically doesn't matter right now.
	}

	interface Run {
		_index?: number
		_implicitBase?: string
	}

	interface Result {
		_log: Log
		_run: Run
		_id: ResultId
		_logRegion?: _Region
		_uri?: string
		_uriContents?: string // ArtifactContent. Do not use this uri for display.
		_relativeUri?: string
		_region?: _Region
		_line: number
		_rule?: ReportingDescriptor
		_message: string
		_markdown?: string
		_suppression?: 'not suppressed' | 'suppressed'
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

export function augmentLog(log: Log) {
	if (log._augmented) return;
	log._augmented = true;
	const fileAndUris = [] as [string, string][];
	log.runs.forEach((run, runIndex) => {
		run._index = runIndex;

		let implicitBase = undefined as string[] | undefined;
		run.results?.forEach((result, resultIndex) => {
			result._log = log;
			result._run = run;
			result._id = [log._uri, runIndex, resultIndex];
			result._logRegion = (() => {
				const region = log._jsonMap?.[`/runs/${runIndex}/results/${resultIndex}`];
				if (!region) return; // Panel will not have a jsonMap
				const {value, valueEnd} = region;
				return [ value.line, value.column, valueEnd.line, valueEnd.column ] as _Region;
			})();

			const ploc = result.locations?.[0]?.physicalLocation;
			const [uri, uriContents] = parseArtifactLocation(result, ploc?.artifactLocation);
			result._uri = uri;
			result._uriContents = uriContents;
			{
				const parts = uri?.split('/');
				implicitBase = // Base calc (inclusive of dash for now)
					implicitBase?.slice(0, Array.commonLength(implicitBase, parts ?? []))
					?? parts;
				const file = parts?.pop();
				if (file && uri) {
					fileAndUris.push([file, uri.replace(/^\//, '')]); // Normalize leading slashes.
				}
			}
			result._region = parseRegion(ploc?.region);
			result._line = (Array.isArray(result._region) ? result._region?.[0] : result._region) ?? -1; // _line is sugar for _region

			result._rule = run.tool.driver.rules?.[result.ruleIndex ?? -1]; // If result.ruleIndex is undefined, that's okay.
			const message = result._rule?.messageStrings?.[result.message.id ?? -1] ?? result.message;
			result._message = format(message.text || result.message?.text, result.message.arguments) ?? '—';
			result._markdown = format(message.markdown || result.message?.markdown, result.message.arguments); // No '—', leave undefined if empty.

			result.level = result.level ?? 'warning';
			result.baselineState = result.baselineState ?? 'new';
			result._suppression = !result.suppressions || result.suppressions.every(sup => sup.status === 'rejected')
				? 'not suppressed'
				: 'suppressed';
		});

		run._implicitBase = implicitBase?.join('/');
		run.results?.forEach(result => {
			result._relativeUri = result._uri?.replace(run._implicitBase ?? '' , '') ?? ''; // For grouping, Empty works more predictably than undefined
		});
	});
	log._distinct = mapDistinct(fileAndUris);
	log._jsonMap = undefined; // Free-up memory.
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

export function parseRegion(region: Region | undefined): _Region | undefined {
	if (!region) return undefined;

	const {byteOffset, byteLength} = region;
	if (byteOffset !== undefined && byteLength !== undefined) return [byteOffset, byteLength] as _RegionBytes;

	let {startLine, startColumn, endLine, endColumn} = region;
	if (!startLine) return undefined; // Lines are 1-based so no need to check undef.

	startLine--;
	if (!startColumn) return startLine;

	startColumn--;
	if (endColumn) endColumn--;
	if (endLine) endLine--;
	return [
		startLine,
		startColumn,
		endLine ?? startLine,
		endColumn ?? (startColumn + 1)
	] as _RegionStartEndLineCol;
}

// Improve: `result` purely used for `_run.artifacts`.
export function parseArtifactLocation(result: Result, anyArtLoc: ArtifactLocation | undefined) {
	if (!anyArtLoc) return [undefined, undefined];
	const runArt = result._run.artifacts?.[anyArtLoc.index ?? -1];
	const runArtLoc = runArt?.location;
	const runArtCon = runArt?.contents;

	const uri = anyArtLoc.uri ?? runArtLoc?.uri; // If index (§3.4.5) is absent, uri SHALL be present.
	const uriContents = runArtCon?.text || runArtCon?.binary
			? encodeURI(`sarif:${encodeURIComponent(result._log._uri)}/${result._run._index}/${anyArtLoc.index}/${uri?.file ?? 'Untitled'}`)
			: undefined;
	return [uri, uriContents];
}

export type Visibility = 'visible' | undefined;

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
		'Absent': undefined,
	},
	Suppression: {
		'Not Suppressed': 'visible',
		'Suppressed': undefined,
	},
};

export const filtersColumn: Record<string, Record<string, Visibility>> = {
	Columns: {
		'Baseline': undefined,
		'Suppression': undefined,
		'Rule': undefined,
	},
};
