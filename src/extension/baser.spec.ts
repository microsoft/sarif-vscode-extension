// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable no-throw-literal */ // Can be removed when we move to vscode.workspace.fs.

import assert from 'assert';
import { URI } from 'vscode-uri';
import '../shared/extension';

const proxyquire = require('proxyquire').noCallThru();

describe('baser', () => {
    it('Array.commonLength', () => {
        const commonLength = Array.commonLength(
            ['a', 'b', 'c'],
            ['a', 'b', 'd']
        );
        assert.strictEqual(commonLength, 2);
    });

    it('Distinct 1', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file:///folder            /file1.txt'.replace(/ /g, '');
        const localUri    = 'file:///projects/project  /file1.txt'.replace(/ /g, '');
        const { Baser } = proxyquire('./baser', {
            'vscode': {
                workspace: {
                    openTextDocument: async (uri: URI) => {
                        if (uri.toString() === localUri) return;
                        throw 'Mock file not found';
                    },
                    textDocuments: [],
                },
                Uri: URI
            },
        });
        const distinctLocalNames = new Map([
            ['file1.txt', localUri]
        ]);
        const distinctArtifactNames = new Map([
            ['file1.txt', artifactUri]
        ]);
        const baser = new Baser(distinctLocalNames, { distinctArtifactNames });
        const rebasedArtifactUri = await baser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri); // Should also match file1?
    });

    it('Picker 1', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file://    /a/b.c'.replace(/ /g, '');
        const localUri    = 'file:///x/y/a/b.c'.replace(/ /g, '');

        const { Baser } = proxyquire('./baser', {
            'vscode': {
                window: {
                    showInformationMessage: async (_message: string, ...choices: string[]) => choices[0], // = [0] => 'Locate...'
                    showOpenDialog: async () => [URI.parse(localUri)],
                },
                workspace: {
                    openTextDocument: async (uri: URI) => {
                        if (uri.toString() === localUri) return;
                        throw 'Mock file not found';
                    },
                    textDocuments: [],
                },
                Uri: URI
            },
        });
        const baser = new Baser(new Map(), { distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await baser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });

    it('Picker 2', async () => {
        // Spaces inserted to emphasize common segments.
        const artifact = 'file:///d/e/f/x/y/a/b.c'.replace(/ /g, '');
        const localUri = 'file://      /x/y/a/b.c'.replace(/ /g, '');

        const { Baser } = proxyquire('./baser', {
            'vscode': {
                window: {
                    showInformationMessage: async (_message: string, ...choices: string[]) => choices[0], // = [0] => 'Locate...'
                    showOpenDialog: async () => [URI.parse(localUri)],
                },
                workspace: {
                    openTextDocument: async (uri: URI) => {
                        if (uri.toString() === localUri) return;
                        throw 'Mock file not found';
                    },
                    textDocuments: [],
                },
                Uri: URI
            },
        });
        const baser = new Baser(new Map(), { distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await baser.translateArtifactToLocal(artifact);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });

    it('commonIndices', async () => {
        const { Baser } = proxyquire('./baser', {
            'vscode': {},
        });
        const pairs = [...Baser.commonIndices(
            ['a', 'b', 'c'],
            ['x', 'b', 'y', 'c', 'z', 'b']
        )];
        assert.deepStrictEqual(pairs, [[ 1, 1 ], [ 1, 5 ], [ 2, 3 ]]);
    });

    it('API-injected baseUris - None, No Match', async () => {
        const artifactUri = 'http:///a/b/c/d.e'.replace(/ /g, '');

        const { Baser } = proxyquire('./baser', {
            'vscode': {
                window: {
                    showInformationMessage: async (_message: string) => undefined,
                },
                workspace: {
                    openTextDocument: async (_uri: URI) => {
                        throw 'Mock file not found';
                    },
                    textDocuments: [],
                },
                Uri: URI
            },
        });
        const baser = new Baser(new Map(), { distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await baser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, '');
    });

    it('API-injected baseUris - Typical', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'http:///a    /b  /c/d.e'.replace(/ /g, '');
        const uriBase     = 'file:///x/y  /b  /z    '.replace(/ /g, '');
        const localUri    = 'file:///x/y  /b  /c/d.e'.replace(/ /g, '');

        const { Baser } = proxyquire('./baser', {
            'vscode': {
                workspace: {
                    openTextDocument: async (uri: URI) => {
                        if (uri.toString() === localUri) return;
                        throw 'Mock file not found';
                    },
                    textDocuments: [],
                },
                Uri: URI
            },
        });
        const baser = new Baser(new Map(), { distinctArtifactNames: new Map() });
        baser.uriBases = [uriBase];
        const rebasedArtifactUri = await baser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });

    it('API-injected baseUris - Short', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'http://  /a/b'.replace(/ /g, '');
        const uriBase     = 'file://  /a  '.replace(/ /g, '');
        const localUri    = 'file://  /a/b'.replace(/ /g, '');

        const { Baser } = proxyquire('./baser', {
            'vscode': {
                workspace: {
                    openTextDocument: async (uri: URI) => {
                        if (uri.toString() === localUri) return;
                        throw 'Mock file not found';
                    },
                    textDocuments: [],
                },
                Uri: URI
            },
        });
        const baser = new Baser(new Map(), { distinctArtifactNames: new Map() });
        baser.uriBases = [uriBase];
        const rebasedArtifactUri = await baser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, localUri);
    });
});
