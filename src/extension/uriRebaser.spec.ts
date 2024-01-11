// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable no-throw-literal */ // Can be removed when we move to vscode.workspace.fs.

import assert from 'assert';
import { URI as Uri } from 'vscode-uri';
import '../shared/extension';
import { mockVscode, mockVscodeTestFacing } from '../test/mockVscode';

const proxyquire = require('proxyquire').noCallThru();

describe('baser', () => {
    const platformUriNormalize = proxyquire('./platformUriNormalize', {
        'vscode': { Uri },
        './platform': 'linux',
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
                '@global': true,
                ...mockVscode,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': () => { throw new Error(); },
        });
        const distinctArtifactNames = new Map([
            [artifactUri.file, artifactUri]
        ]);

        // Need to restructure product+test to better simulate the calculation distinctLocalNames.
        const rebaser = new UriRebaser({ distinctArtifactNames });
        assert.strictEqual(await rebaser.translateLocalToArtifact(Uri.parse(localUri)), artifactUri);
    });

    it('translates uris - local -> artifact - case-sensitive file system', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file://  /a/b'.replace(/ /g, '');
        const localUri    = 'file://  /a/b'.replace(/ /g, '');
        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                '@global': true,
                ...mockVscode,
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
                '@global': true,
                ...mockVscode,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const distinctArtifactNames = new Map([
            ['file1.txt', artifactUri]
        ]);
        const rebaser = new UriRebaser({ distinctArtifactNames });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri.toString(), localUri); // Should also match file1?
    });

    it('Picker 1', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file://    /a/file.txt'.replace(/ /g, '');
        const localUri    = 'file:///x/y/a/file.txt'.replace(/ /g, '');
        mockVscodeTestFacing.showOpenDialogResult = [Uri.parse(localUri)];
        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri.toString(), localUri);
    });

    it('Picker 2', async () => {
        // Spaces inserted to emphasize common segments.
        const artifact = 'file:///d/e/f/x/y/a/b.c'.replace(/ /g, '');
        const localUri = 'file://      /x/y/a/b.c'.replace(/ /g, '');
        mockVscodeTestFacing.showOpenDialogResult = [Uri.parse(localUri)];

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifact);
        assert.strictEqual(rebasedArtifactUri.toString(), localUri);
    });

    it('API-injected baseUris - None, No Match', async () => {
        const artifactUri = 'http:///a/b/c/d.e'.replace(/ /g, '');

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (_uri: string) => false,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri, undefined);
    });

    it('API-injected baseUris - Typical', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'http:///a    /b  /c/d.e'.replace(/ /g, '');
        const uriBase     = 'file:///x/y  /b  /z    '.replace(/ /g, '');
        const localUri    = 'file:///x/y  /b  /c/d.e'.replace(/ /g, '');
        mockVscodeTestFacing.showOpenDialogResult = [Uri.parse(localUri)];

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        rebaser.uriBases = [uriBase];
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri.toString(), localUri);
    });

    it('API-injected baseUris - Short', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'http://  /a/b'.replace(/ /g, '');
        const uriBase     = 'file://  /a  '.replace(/ /g, '');
        const localUri    = 'file://  /a/b'.replace(/ /g, '');
        mockVscodeTestFacing.showOpenDialogResult = [Uri.parse(localUri)];

        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': {
                '@global': true,
                ...mockVscode,
            },
            './platformUriNormalize': platformUriNormalize,
            './uriExists': (uri: string) => uri.toString() === localUri,
        });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        rebaser.uriBases = [uriBase];
        const rebasedArtifactUri = await rebaser.translateArtifactToLocal(artifactUri);
        assert.strictEqual(rebasedArtifactUri.toString(), localUri);
    });
});
