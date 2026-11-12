// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';
import { ThreadFlowLocation } from 'sarif';
import { buildTraceItems, isCollapsedTraceGroup, traceBaseNestingLevel, traceImportance, traceNestingDepth } from './traceView';

function step(importance?: ThreadFlowLocation['importance'], nestingLevel?: number): ThreadFlowLocation {
    return { importance, nestingLevel };
}

describe('TraceView', () => {
    it('uses the SARIF default importance', () => {
        assert.strictEqual(traceImportance(step()), 'important');
        assert.strictEqual(traceImportance(step('essential')), 'essential');
        assert.strictEqual(traceImportance(step('unimportant')), 'unimportant');
    });

    it('normalizes nesting levels relative to the shallowest location', () => {
        const locations = [step('important', 2), step('important', 4), step()];
        const baseLevel = traceBaseNestingLevel(locations);

        assert.strictEqual(baseLevel, 2);
        assert.strictEqual(traceNestingDepth(locations[0], baseLevel), 0);
        assert.strictEqual(traceNestingDepth(locations[1], baseLevel), 2);
        assert.strictEqual(traceNestingDepth(locations[2], baseLevel), 0);
    });

    it('collapses consecutive unimportant locations in normal view', () => {
        const locations = [
            step('important'),
            step('unimportant'),
            step('unimportant'),
            step('essential'),
            step('unimportant'),
        ];
        const items = buildTraceItems(locations, false, new Set());

        assert.strictEqual(items.length, 4);
        assert.strictEqual(items[0], locations[0]);
        assert.ok(isCollapsedTraceGroup(items[1]));
        if (isCollapsedTraceGroup(items[1])) {
            assert.strictEqual(items[1].key, '1-2');
            assert.deepStrictEqual(items[1].locations, locations.slice(1, 3));
        }
        assert.strictEqual(items[2], locations[3]);
        assert.ok(isCollapsedTraceGroup(items[3]));
    });

    it('expands one group without expanding the rest', () => {
        const locations = [
            step('important'),
            step('unimportant'),
            step('unimportant'),
            step('essential'),
            step('unimportant'),
        ];
        const items = buildTraceItems(locations, false, new Set(['1-2']));

        assert.strictEqual(items.length, 6);
        assert.ok(isCollapsedTraceGroup(items[1]));
        assert.strictEqual(items[2], locations[1]);
        assert.strictEqual(items[3], locations[2]);
        assert.ok(isCollapsedTraceGroup(items[5]));
    });

    it('returns the original locations in full view', () => {
        const locations = [step('important'), step('unimportant')];
        assert.strictEqual(buildTraceItems(locations, true, new Set()), locations);
    });
});
