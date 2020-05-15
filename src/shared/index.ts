// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ArtifactLocation, Log, Location, Region, Result } from 'sarif'

type JsonLocation = { line: number, column: number } // Unused: pos
type JsonRange = { value: JsonLocation, valueEnd: JsonLocation } // Unused: key, keyEnd
export type JsonMap = Record<string, JsonRange>

export type ResultId = [string, number, number]
export type _Region = number | [number, number] | [number, number, number, number]

// Underscored members are ptional in the source files, but required after preprocessing.
declare module 'sarif' {
	interface Log {
		_uri?: string
		_uriUpgraded?: string
		_jsonMap?: JsonMap
		_augmented?: boolean
		_distinct?: Map<string, string> // Technically per Run, practially does't matter right now.
	}

	interface Run {
		_index?: number
		_implicitBase?: string
	}

	interface Result {
		_log?: Log
		_run?: Run
		_id?: ResultId
		_logRegion?: _Region
		_uri?: string
		_uriContents?: string // ArtifactContent. Do not use this uri for display.
		_relativeUri?: string
		_region?: _Region
		_line?: number
		_rule?: ReportingDescriptor
		_message?: string
		_markdown?: string
		_suppression?: 'not suppressed' | 'suppressed'
	}
}

// console.log(format(`'{0}' was not evaluated for check '{2}' as the analysis is not relevant based on observed metadata: {1}.`, ['x', 'y', 'z']))
function format(template: string, args?: string[]) {
	if (!template) return undefined
	if (!args) return template
	return template.replace(/{(\d+)}/g, (_, group) => args[group])
}

export function mapDistinct(pairs: [string, string][]): Map<string, string> {
	const distinct = new Map<string, string>()
	for (const [key, value] of pairs) {
		if (distinct.has(key)) {
			const otherValue = distinct.get(key)
			if (value !== otherValue) distinct.set(key, undefined)
		} else {
			distinct.set(key, value)
		}
	}
	for (const [key, value] of distinct) {
		if (!value) distinct.delete(key)
	}
	return distinct
}

export function augmentLog(log: Log) {
	if (log._augmented) return
	log._augmented = true
	const fileAndUris = [] as [string, string][]
	log.runs.forEach((run, runIndex) => {
		run._index = runIndex

		let implicitBase = undefined as string[]
		run.results?.forEach((result, resultIndex) => {
			result._log = log
			result._run = run
			result._id = [log._uri, runIndex, resultIndex]
			result._logRegion = (() => {
				const region = log._jsonMap?.[`/runs/${runIndex}/results/${resultIndex}`]
				if (!region) return // Panel will not have a jsonMap
				const {value, valueEnd} = region
				return [ value.line, value.column, valueEnd.line, valueEnd.column ] as _Region
			})()

			const ploc = result.locations?.[0]?.physicalLocation
			const [uri, uriContents] = parseArtifactLocation(result, ploc?.artifactLocation)
			result._uri = uri
			result._uriContents = uriContents
			{
				const parts = uri?.split('/')
				implicitBase = // Base calc (inclusive of dash for now)
					implicitBase?.slice(0, Array.commonLength(implicitBase, parts ?? []))
					?? parts
				const file = parts?.pop()
				if (file && uri) {
					fileAndUris.push([file, uri.replace(/^\//, '')]) // Normalize leading slashes.
				}
			}
			result._region = parseRegion(ploc?.region)
			result._line = result._region?.[0] ?? result._region ?? -1 // _line is sugar for _region

			result._rule = run.tool.driver.rules?.[result.ruleIndex] // If result.ruleIndex is undefined, that's okay.
			const message = result._rule?.messageStrings?.[result.message.id] ?? result.message
			result._message = format(message.text || result.message?.text, result.message.arguments) ?? '—'
			result._markdown = format(message.markdown || result.message?.markdown, result.message.arguments) // No '—', leave undefined if empty.

			result.level = result.level ?? 'warning'
			result.baselineState = result.baselineState ?? 'new'
			result._suppression = !result.suppressions || result.suppressions.every(sup => sup.status === 'rejected')
				? 'not suppressed'
				: 'suppressed'
		})

		run._implicitBase = implicitBase?.join('/')
		run.results?.forEach(result => {
			result._relativeUri = result._uri?.replace(run._implicitBase , '') ?? '' // For grouping, Empty works more predictably than undefined
		})
	})
	log._distinct = mapDistinct(fileAndUris)
	log._jsonMap = undefined // Free-up memory.
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
	const message = loc?.message?.text
	const [uri, uriContent] = parseArtifactLocation(result, loc?.physicalLocation?.artifactLocation)
	const region = loc?.physicalLocation?.region
	return { message, uri, uriContent, region }
}

export function parseRegion(region: Region): _Region {
	if (!region) return undefined

	const {byteOffset, byteLength} = region
	if (byteOffset !== undefined && byteLength !== undefined) return [byteOffset, byteLength] as [number, number]

	let {startLine, startColumn, endLine, endColumn} = region
	if (!startLine) return undefined // Lines are 1-based so no need to check undef.

	startLine--
	if (!startColumn) return startLine

	startColumn--
	if (endColumn) endColumn--
	if (endLine) endLine--
	return [
		startLine,
		startColumn,
		endLine ?? startLine,
		endColumn ?? (startColumn + 1)
	] as [number, number, number, number]
}

// Improve: `result` purely used for `_run.artifacts`.
export function parseArtifactLocation(result: Result, anyArtLoc: ArtifactLocation) {
	if (!anyArtLoc) return [undefined, undefined]
	const runArt = result._run.artifacts?.[anyArtLoc.index ?? -1]
	const runArtLoc = runArt?.location
	const runArtCon = runArt?.contents

	const uri = anyArtLoc.uri ?? runArtLoc?.uri // If index (§3.4.5) is absent, uri SHALL be present.
	const uriContents = runArtCon?.text || runArtCon?.binary
			? encodeURI(`sarif:${encodeURIComponent(result._log._uri)}/${result._run._index}/${anyArtLoc.index}/${uri.file ?? 'Untitled'}`)
			: undefined
	return [uri, uriContents]
}

export const filtersRow = {
	Level: {
		'Error': true,
		'Warning': true,
		'Note': true,
		'None': true,
	},
	Baseline: {
		'New': true,
		'Unchanged': true,
		'Updated': true,
		'Absent': false,
	},
	Suppression: {
		'Not Suppressed': true,
		'Suppressed': false,
	},
}

export const filtersColumn = {
	Columns: {
		'Baseline': false,
		'Suppression': false,
		'Rule': false,
	},
}
