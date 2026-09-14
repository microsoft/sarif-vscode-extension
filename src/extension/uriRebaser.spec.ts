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
});

describe('baser workspace filename searches', () => {
    function loadBaser(
        findFiles: (include: string, exclude?: string, maxResults?: number) => Promise<Uri[]>,
        normalize: (uri: Uri) => Uri = uri => uri) {
        const eventHandlers: {
            create?: (event: { files: Uri[] }) => void;
            rename?: (event: { files: { oldUri: Uri, newUri: Uri }[] }) => void;
            delete?: (event: { files: Uri[] }) => void;
            folders?: () => void;
        } = {};
        const workspace = {
            ...mockVscode.workspace,
            workspaceFolders: [{ uri: Uri.file('/workspace') }],
            findFiles,
            onDidCreateFiles: (handler: typeof eventHandlers.create) => eventHandlers.create = handler,
            onDidRenameFiles: (handler: typeof eventHandlers.rename) => eventHandlers.rename = handler,
            onDidDeleteFiles: (handler: typeof eventHandlers.delete) => eventHandlers.delete = handler,
            onDidChangeWorkspaceFolders: (handler: () => void) => eventHandlers.folders = handler,
        };
        const { UriRebaser } = proxyquire('./uriRebaser', {
            'vscode': { '@global': true, ...mockVscode, workspace },
            './platformUriNormalize': normalize,
            './uriExists': () => false,
        });
        return { UriRebaser, eventHandlers };
    }

    function rebaserFor(UriRebaser: typeof import('./uriRebaser').UriRebaser, filename: string) {
        return new UriRebaser({ distinctArtifactNames: new Map([[filename, `file:///artifact/${filename}`]]) });
    }

    it('does not search for a basename absent from the SARIF artifacts in either direction', async () => {
        let calls = 0;
        const { UriRebaser } = loadBaser(async () => { calls++; return []; });
        const rebaser = new UriRebaser({ distinctArtifactNames: new Map() });
        assert.strictEqual(await rebaser.translateLocalToArtifact(Uri.file('/workspace/absent.txt')), undefined);
        assert.strictEqual(await rebaser.translateArtifactToLocal('file:///artifact/absent.txt', undefined), undefined);
        assert.strictEqual(calls, 0);
    });

    it('caches missing and ambiguous filenames', async () => {
        let calls = 0;
        const { UriRebaser } = loadBaser(async (_include: string, _exclude?: string, maxResults?: number) => {
            calls++;
            assert.strictEqual(maxResults, undefined);
            return calls === 1 ? [] : [Uri.file('/a/file.txt'), Uri.file('/b/file.txt')];
        });
        const missing = rebaserFor(UriRebaser, 'missing.txt');
        await missing.translateLocalToArtifact(Uri.file('/workspace/missing.txt'));
        await missing.translateLocalToArtifact(Uri.file('/workspace/missing.txt'));
        const ambiguous = rebaserFor(UriRebaser, 'file.txt');
        await ambiguous.translateLocalToArtifact(Uri.file('/workspace/file.txt'));
        await ambiguous.translateLocalToArtifact(Uri.file('/workspace/file.txt'));
        assert.strictEqual(calls, 2);
    });

    it('shares same-name work and serializes different filename searches', async () => {
        let calls = 0;
        let active = 0;
        let maxActive = 0;
        let releaseFirst: (uris: Uri[]) => void = () => {};
        const firstSearch = new Promise<Uri[]>(resolve => releaseFirst = resolve);
        const { UriRebaser } = loadBaser(async () => {
            calls++;
            active++;
            maxActive = Math.max(maxActive, active);
            if (calls === 1) await firstSearch;
            active--;
            return [];
        });
        const first = rebaserFor(UriRebaser, 'first.txt');
        const firstA = first.translateLocalToArtifact(Uri.file('/workspace/first.txt'));
        const firstB = first.translateLocalToArtifact(Uri.file('/other/first.txt'));
        const burst = Array.from({ length: 3 }, (_, i) => {
            const filename = `other-${i}.txt`;
            return rebaserFor(UriRebaser, filename).translateLocalToArtifact(Uri.file(`/workspace/${filename}`));
        });
        await Promise.resolve();
        assert.strictEqual(calls, 1);
        releaseFirst([]);
        await Promise.all([firstA, firstB, ...burst]);
        assert.strictEqual(calls, 4);
        assert.strictEqual(maxActive, 1);
    });

    it('uses the platform URI normalization semantics when case variants coexist', async () => {
        const lower = Uri.file('/workspace/source.txt');
        const upper = Uri.file('/workspace/SOURCE.TXT');
        const candidates = async () => [lower, upper];

        const identity = loadBaser(candidates);
        const identityRebaser = rebaserFor(identity.UriRebaser, 'source.txt');
        assert.strictEqual(await identityRebaser.translateLocalToArtifact(lower), 'file:///artifact/source.txt');

        const normalizeCase = (uri: Uri) => uri.with({ path: uri.path.toLowerCase() });
        const caseNormalizing = loadBaser(candidates, normalizeCase);
        const caseNormalizingRebaser = rebaserFor(caseNormalizing.UriRebaser, 'source.txt');
        assert.strictEqual(await caseNormalizingRebaser.translateLocalToArtifact(lower), undefined);
    });

    it('retries failed searches', async () => {
        let calls = 0;
        const { UriRebaser } = loadBaser(async () => {
            if (++calls === 1) throw new Error('search failed');
            return [];
        });
        const rebaser = rebaserFor(UriRebaser, 'retry.txt');
        await assert.rejects(rebaser.translateLocalToArtifact(Uri.file('/workspace/retry.txt')));
        await rebaser.translateLocalToArtifact(Uri.file('/workspace/retry.txt'));
        assert.strictEqual(calls, 2);
    });

    it('does not publish a pending result after normalized invalidation', async () => {
        let calls = 0;
        let release: (uris: Uri[]) => void = () => {};
        const pendingSearch = new Promise<Uri[]>(resolve => release = resolve);
        const { UriRebaser, eventHandlers } = loadBaser(async () => {
            calls++;
            return calls === 1 ? pendingSearch : [];
        }, uri => uri.with({ path: uri.path.toLowerCase() }));
        const rebaser = rebaserFor(UriRebaser, 'changing.txt');
        const pending = rebaser.translateLocalToArtifact(Uri.file('/workspace/changing.txt'));
        await Promise.resolve();
        eventHandlers.create!({ files: [Uri.file('/workspace/CHANGING.TXT')] });
        release([Uri.file('/workspace/changing.txt')]);
        assert.strictEqual(await pending, undefined);
        await rebaser.translateLocalToArtifact(Uri.file('/workspace/changing.txt'));
        assert.strictEqual(calls, 2);
    });

    it('uses uncapped escaped, decoded basename globs', async () => {
        const cases = [['space%20name.txt', 'space name.txt'],
            ['literal%2520name.txt', 'literal%20name.txt'], ['bad%.txt', 'bad%.txt'],
            ['my%20%5Bfile%5D%2A%3F.txt', 'my [file]*?.txt']];
        let include = '';
        for (const [artifactName, localName] of cases) {
            const local = Uri.file(`/workspace/${localName}`);
            const { UriRebaser } = loadBaser(async (value, _exclude, maxResults) => {
                include = value;
                assert.strictEqual(maxResults, undefined);
                return [local];
            });
            const artifact = `file:///artifact/${artifactName}`;
            const result = await rebaserFor(UriRebaser, artifactName).translateArtifactToLocal(artifact, undefined);
            assert.strictEqual(result?.toString(), local.toString());
            assert.notStrictEqual(include, '**/*');
        }
        assert.strictEqual(include, '**/[mM][yY] [[][fF][iI][lL][eE][]][*][?].[tT][xX][tT]');
    });

    it('invalidates both normalized rename names, file changes, and workspace-folder changes', async () => {
        let calls = 0;
        const { UriRebaser, eventHandlers } = loadBaser(async () => { calls++; return []; },
            uri => uri.with({ path: uri.path.toLowerCase() }));
        const oldFile = rebaserFor(UriRebaser, 'old.txt'); const oldUri = Uri.file('/workspace/old.txt');
        const newFile = rebaserFor(UriRebaser, 'new.txt'); const newUri = Uri.file('/workspace/new.txt');
        await oldFile.translateLocalToArtifact(oldUri);
        await newFile.translateLocalToArtifact(newUri);
        eventHandlers.rename!({ files: [{ oldUri: Uri.file('/workspace/OLD.TXT'), newUri: Uri.file('/workspace/NEW.TXT') }] });
        await oldFile.translateLocalToArtifact(oldUri);
        await newFile.translateLocalToArtifact(newUri);
        eventHandlers.create!({ files: [Uri.file('/workspace/old.txt')] });
        await oldFile.translateLocalToArtifact(oldUri);
        eventHandlers.delete!({ files: [Uri.file('/workspace/new.txt')] });
        await newFile.translateLocalToArtifact(newUri);
        eventHandlers.folders!();
        await oldFile.translateLocalToArtifact(oldUri);
        assert.strictEqual(calls, 7);
    });
});
