// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable no-throw-literal */ // Can be removed when we move to vscode.workspace.fs.

import assert from 'assert';
import { URI as Uri } from 'vscode-uri';
import '../shared/extension';

const proxyquire = require('proxyquire').noCallThru();

describe('baser', () => {
    const platformUriNormalize = proxyquire('./platformUriNormalize', {
        'vscode': { Uri },
        './platform': 'darwin',
    });

    it('Array.commonLength', () => {
        const commonLength = Array.commonLength(
            ['a', 'b', 'c'],
            ['a', 'b', 'd']
        );
        assert.strictEqual(commonLength, 2);
    });

    it('translates uris - local -> artifact - case-insensitive file system', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file://  /a/b'.replace(/ /g, '');
        const localUri    = 'file://  /a/B'.replace(/ /g, '');
        const platformUriNormalize = proxyquire('./platformUriNormalize', {
            'vscode': { Uri },
            './platform': 'win32',
        });
        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                workspace: {
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': () => { throw new Error(); },
        });
        const distinctArtifactNames = new Map([
            [artifactUri.file, artifactUri]
        ]);

        // Need to restructure product+test to better simulate the calculation distinctLocalNames.
        const rebaser = new UriRebaser({ distinctArtifactNames });
        assert.strictEqual(await rebaser.translateLocalToArtifact(localUri), artifactUri);
    });

    it('translates uris - local -> artifact - case-sensitive file system', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file://  /a/b'.replace(/ /g, '');
        const localUri    = 'file://  /a/B'.replace(/ /g, '');
        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                workspace: {
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': () => { throw new Error(); },
        });
        const distinctArtifactNames = new Map([
            [artifactUri.file, artifactUri]
        ]);
        const rebaser = new UriRebaser({ distinctArtifactNames });
        assert.strictEqual(await rebaser.translateLocalToArtifact(localUri), localUri);
    });

    it('Distinct 1', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file:///folder            /file1.txt'.replace(/ /g, '');
        const localUri    = 'file:///projects/project  /file1.txt'.replace(/ /g, '');
        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                workspace: {
                    findFiles: () => [Uri.file('projects/project/file1.txt')],
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const distinctArtifactNames = new Map([
            ['file1.txt', artifactUri]
        ]);
        const rebaser = new UriRebaser({ distinctArtifactNames });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri); // Should also match file1?
    });

    it('Picker 1', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file://    /a/b.c'.replace(/ /g, '');
        const localUri    = 'file:///x/y/a/b.c'.replace(/ /g, '');

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                window: {
                    showInformationMessage: async (_message: string, ...choices: string[]) => choices[0], // = [0] => 'Locate...'
                    showOpenDialog: async () => [Uri.parse(localUri)],
                },
                workspace: {
                    findFiles: () => [],
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });

    it('Picker 2', async () => {
        // Spaces inserted to emphasize common segments.
        const artifact = 'file:///d/e/f/x/y/a/b.c'.replace(/ /g, '');
        const localUri = 'file://      /x/y/a/b.c'.replace(/ /g, '');

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                window: {
                    showInformationMessage: async (_message: string, ...choices: string[]) => choices[0], // = [0] => 'Locate...'
                    showOpenDialog: async () => [Uri.parse(localUri)],
                },
                workspace: {
                    findFiles: () => [],
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifact);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });

    it('commonIndices', async () => {
        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {},
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (_uri: string) => false,
        });
        const pairs = [...UriRebaser.commonIndices(
            ['a', 'b', 'c'],
            ['x', 'b', 'y', 'c', 'z', 'b']
        )];
        assert.deepStrictEqual(pairs, [[ 1, 1 ], [ 1, 5 ], [ 2, 3 ]]);
    });

    it('API-injected baseUris - None, No Match', async () => {
        const artifactUri = 'http:///a/b/c/d.e'.replace(/ /g, '');

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                window: {
                    showInformationMessage: async (_message: string) => undefined,
                },
                workspace: {
                    findFiles: () => [],
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (_uri: string) => false,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, '');
    });

    it('API-injected baseUris - Typical', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'http:///a    /b  /c/d.e'.replace(/ /g, '');
        const uriBase     = 'file:///x/y  /b  /z    '.replace(/ /g, '');
        const localUri    = 'file:///x/y  /b  /c/d.e'.replace(/ /g, '');

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                workspace: {
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        rebaser.uriBases = [uriBase];
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });

    it('API-injected baseUris - Short', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'http://  /a/b'.replace(/ /g, '');
        const uriBase     = 'file://  /a  '.replace(/ /g, '');
        const localUri    = 'file://  /a/b'.replace(/ /g, '');

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                workspace: {
                    textDocuments: [],
                },
                Uri,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        rebaser.uriBases = [uriBase];
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });
});
