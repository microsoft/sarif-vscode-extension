// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';
import { Result, ThreadFlowLocation } from 'sarif';
import { traceLocationsInArtifact } from './traceLocationFilter';

describe('trace location file filtering', () => {
    const result = {
        _run: {
            artifacts: [
                { location: { uri: 'a.c' } },
                { location: { uri: 'b.c' } },
            ],
        },
    } as Result;
    const locations = [
        { location: { physicalLocation: { artifactLocation: { index: 0 } } } },
        { location: { physicalLocation: { artifactLocation: { index: 1 } } } },
        { location: { physicalLocation: { artifactLocation: { index: 0 } } } },
    ] as ThreadFlowLocation[];

    it('keeps only steps from the current artifact in their original order', () => {
        assert.deepStrictEqual(traceLocationsInArtifact(result, locations, 'a.c'), [locations[0], locations[2]]);
        assert.deepStrictEqual(traceLocationsInArtifact(result, locations, 'b.c'), [locations[1]]);
    });

    it('does not decorate an unresolved or unrelated document', () => {
        assert.deepStrictEqual(traceLocationsInArtifact(result, locations, undefined), []);
        assert.deepStrictEqual(traceLocationsInArtifact(result, locations, 'c.c'), []);
    });
});
