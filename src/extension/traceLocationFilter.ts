// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Result, ThreadFlowLocation } from 'sarif';
import { parseArtifactLocation } from '../shared';

export function traceLocationsInArtifact(result: Result, locations: ThreadFlowLocation[], artifactUri?: string) {
    if (artifactUri === undefined) return [];
    return locations.filter(tfl => {
        const [uri] = parseArtifactLocation(result, tfl.location?.physicalLocation?.artifactLocation);
        return uri === artifactUri;
    });
}
