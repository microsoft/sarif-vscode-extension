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

    it('translates uris - local -> artifact - case-sensitive file system (lowercase)', async () => {
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
        assert.strictEqual(await rebaser.translateLocalToArtifact(localUri), artifactUri);
    });

    it('translates uris - local -> artifact - case-sensitive file system (uppercase)', async () => {
        // Spaces inserted to emphasize common segments.
        const artifactUri = 'file://  /a/B'.replace(/ /g, '');
        const localUri    = 'file://  /a/B'.replace(/ /g, '');
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
        assert.strictEqual(await rebaser.translateLocalToArtifact(localUri), artifactUri);
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

    describe('workspace search for a distinct filename', () => {
        const directions = ['local to artifact', 'artifact to local'];
        // Each search waits until the test ends it, so a test can act while the search runs.
        const releasedSearches = () => {
            const searches: { resolve: (files: Uri[]) => void }[] = [];
            const findFiles = () => new Promise<Uri[]>(resolve => searches.push({ resolve }));
            return { findFiles, searches };
        };
        const searchStarted = () => new Promise(resolve => setImmediate(resolve));

        for (const platform of ['linux', 'win32']) {
            const loadUriRebaser = (findFiles: () => Promise<Uri[]>) => {
                const { UriRebaser } = proxyquire('./uriRebaser', {
                    'vscode': {
                        '@global': true,
                        ...mockVscode,
                        // No 'Locate...' choice, so a lookup that finds nothing does not open a file dialog.
                        window: { ...mockVscode.window, showInformationMessage: async () => undefined },
                        workspace: { ...mockVscode.workspace, workspaceFolders: [{ uri: Uri.file('/w') }], findFiles },
                    },
                    './platform': platform,
                    './platformUriNormalize': platformUriNormalize,
                    './uriExists': () => false,
                });
                return UriRebaser;
            };

            it(`does not search for a name that is not a distinct SARIF artifact name (${platform})`, async () => {
                let searches = 0;
                const UriRebaser = loadUriRebaser(async () => { searches++; return [Uri.file('/w/a.c')]; });
                const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
                assert.strictEqual(await rebaser.translateLocalToArtifact(Uri.file('/w/a.c')), undefined);
                assert.strictEqual(await rebaser.translateArtifactToLocal('file:///ci/a.c', undefined), undefined);
                assert.strictEqual(searches, 0);
            });

            it(`does not search for a name that the loaded logs do not hold (${platform})`, async () => {
                for (const direction of directions) {
                    let searches = 0;
                    const UriRebaser = loadUriRebaser(async () => { searches++; return [Uri.file('/w/a.c')]; });
                    const rebaser = new UriRebaser({ distinctArtifactNames: new Map([['b.c', 'file:///ci/b.c']]) });
                    const translated = direction === 'local to artifact'
                        ? await rebaser.translateLocalToArtifact(Uri.file('/w/a.c'))
                        : await rebaser.translateArtifactToLocal('file:///ci/a.c', undefined);
                    assert.strictEqual(translated, undefined, direction);
                    assert.strictEqual(searches, 0, direction);
                }
            });

            it(`maps a distinct SARIF artifact name that the search finds once (${platform})`, async () => {
                for (const direction of directions) {
                    let searches = 0;
                    const UriRebaser = loadUriRebaser(async () => { searches++; return [Uri.file('/w/a.c')]; });
                    const rebaser = new UriRebaser({ distinctArtifactNames: new Map([['a.c', 'file:///ci/a.c']]) });
                    const translated = direction === 'local to artifact'
                        ? await rebaser.translateLocalToArtifact(Uri.file('/w/a.c'))
                        : await rebaser.translateArtifactToLocal('file:///ci/a.c', undefined);
                    assert.strictEqual(translated?.toString(), direction === 'local to artifact' ? 'file:///ci/a.c' : 'file:///w/a.c', direction);
                    assert.strictEqual(searches, 1, direction);
                }
            });

            it(`does not map a name whose log closes during the search (${platform})`, async () => {
                for (const direction of directions) {
                    const distinctArtifactNames = new Map([['a.c', 'file:///ci/a.c']]);
                    const { findFiles, searches } = releasedSearches();
                    const UriRebaser = loadUriRebaser(findFiles);
                    const rebaser = new UriRebaser({ distinctArtifactNames });
                    const translated = direction === 'local to artifact'
                        ? rebaser.translateLocalToArtifact(Uri.file('/w/a.c'))
                        : rebaser.translateArtifactToLocal('file:///ci/a.c', undefined);
                    await searchStarted();
                    assert.strictEqual(searches.length, 1, direction);
                    distinctArtifactNames.clear();
                    searches[0].resolve([Uri.file('/w/a.c')]);
                    assert.strictEqual(await translated, undefined, direction);
                    assert.strictEqual(searches.length, 1, direction);
                }
            });
        }
    });
});
