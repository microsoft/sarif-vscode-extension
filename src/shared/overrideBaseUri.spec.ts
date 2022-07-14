// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';
import { Log } from 'sarif';
import { overrideBaseUri } from './overrideBaseUri';

describe('overrideBaseUri', () => {
    function createBasicLog(): Log {
        return {
            runs: [
                {
                    originalUriBaseIds: {
                        SRCROOT_1: {
                            uri: 'file:///var/jenkins_home/workspace/org/workflow/project/1/',
                        },
                        SRCROOT_2: {
                            uri: 'file:///var/jenkins_home/workspace/org/workflow/project/2/',
                        },
                    },
                },
                {
                    originalUriBaseIds: {
                        SRCROOT_3: {
                            uri: 'file:///var/jenkins_home/workspace/org/workflow/project/1/',
                        },
                        SRCROOT_4: {
                            uri: 'file:///var/jenkins_home/workspace/org/workflow/project/2/',
                        },
                    },
                },
            ],
        } as unknown as Log;
    }

    it('overrides all originalUriBaseIds uri values (most common case)', async () => {
        const log = createBasicLog();
        const newBaseUri = 'file:///path/to/project';
        overrideBaseUri(log, newBaseUri);
        assert.strictEqual(log.runs![0].originalUriBaseIds!.SRCROOT_1.uri, newBaseUri);
        assert.strictEqual(log.runs![0].originalUriBaseIds!.SRCROOT_2.uri, newBaseUri);
        assert.strictEqual(log.runs![1].originalUriBaseIds!.SRCROOT_3.uri, newBaseUri);
        assert.strictEqual(log.runs![1].originalUriBaseIds!.SRCROOT_4.uri, newBaseUri);
    });

    it('does not throw if log has no runs', async () => {
        overrideBaseUri({} as Log, 'file:///path/to/project');
    });

    it('does not throw if newBaseUri is undefined', async () => {
        overrideBaseUri(createBasicLog(), undefined);
    });

    it('does not throw if newBaseUri is empty', async () => {
        overrideBaseUri(createBasicLog(), '');
    });
});
