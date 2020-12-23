// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Log } from 'sarif';

export type ResultCountByArtifactByRule = Map<string, Map<string, number>>;

export function resultCountByArtifactByRule(logs: Log[]) {
    const artifacts = new Map<string, Map<string, number>>();
    logs.forEach(log => {
        log.runs?.forEach(run => {
            run.results?.forEach(result => {
                const uri = result._uri; // only accounts for the primary location.
                if (!uri) return;
                if (!artifacts.has(uri)) {
                    artifacts.set(uri, new Map<string, number>());
                }
                const resultCountByRule = artifacts.get(uri)!;
                const ruleId = result._rule?.id ?? 'undefined';
                if (!resultCountByRule.has(ruleId)) {
                    resultCountByRule.set(ruleId, 0);
                }
                const count = resultCountByRule.get(ruleId)!;
                resultCountByRule.set(ruleId, count + 1);
            });
        });
    });
    return artifacts;
}
