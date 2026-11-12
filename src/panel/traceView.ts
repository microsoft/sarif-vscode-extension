// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ThreadFlowLocation } from 'sarif';

export type TraceImportance = 'essential' | 'important' | 'unimportant'

export interface CollapsedTraceGroup {
    type: 'collapsed';
    key: string;
    startIndex: number;
    endIndex: number;
    locations: ThreadFlowLocation[];
}

export type TraceItem = ThreadFlowLocation | CollapsedTraceGroup

export function traceImportance(location: ThreadFlowLocation): TraceImportance {
    // SARIF 2.1.0 section 3.38.13: absent importance defaults to "important".
    return location.importance ?? 'important';
}

export function isCollapsedTraceGroup(item: TraceItem): item is CollapsedTraceGroup {
    return (item as CollapsedTraceGroup).type === 'collapsed';
}

export function traceBaseNestingLevel(locations: ThreadFlowLocation[]): number {
    const levels = locations
        .map(location => location.nestingLevel)
        .filter((level): level is number => level !== undefined);
    return levels.length ? Math.min(...levels) : 0;
}

export function traceNestingDepth(location: ThreadFlowLocation, baseLevel: number): number {
    return location.nestingLevel === undefined
        ? 0
        : Math.max(0, location.nestingLevel - baseLevel);
}

export function buildTraceItems(
    locations: ThreadFlowLocation[],
    showAll: boolean,
    expandedGroups: ReadonlySet<string>,
): TraceItem[] {
    if (showAll) return locations;

    const items: TraceItem[] = [];
    for (let index = 0; index < locations.length;) {
        if (traceImportance(locations[index]) !== 'unimportant') {
            items.push(locations[index]);
            index++;
            continue;
        }

        const startIndex = index;
        while (index < locations.length && traceImportance(locations[index]) === 'unimportant') {
            index++;
        }
        const endIndex = index - 1;
        const key = `${startIndex}-${endIndex}`;
        const group: CollapsedTraceGroup = {
            type: 'collapsed',
            key,
            startIndex,
            endIndex,
            locations: locations.slice(startIndex, index),
        };
        items.push(group);
        if (expandedGroups.has(key)) items.push(...group.locations);
    }
    return items;
}
