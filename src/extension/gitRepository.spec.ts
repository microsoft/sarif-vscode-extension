// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'assert';
import { stub } from 'sinon';
import { API, Repository } from './git';
import { openPrimaryRepository } from './gitRepository';

const proxyquire = require('proxyquire').noCallThru();

function repository(root: string): Repository {
    return {
        rootUri: {
            toString: () => root,
        },
    } as unknown as Repository;
}

describe('openPrimaryRepository', () => {
    it('does not open a repository without a workspace', async () => {
        const openRepository = stub().resolves(repository('file:///workspace'));
        const git = {
            repositories: [repository('file:///workspace')],
            openRepository,
        } as unknown as API;

        assert.strictEqual(await openPrimaryRepository(git, undefined), undefined);
        assert.strictEqual(openRepository.called, false);
    });

    it('does not open a repository that does not match the workspace', async () => {
        const openRepository = stub().resolves(repository('file:///other'));
        const git = {
            repositories: [repository('file:///other')],
            openRepository,
        } as unknown as API;

        assert.strictEqual(await openPrimaryRepository(git, 'file:///workspace'), undefined);
        assert.strictEqual(openRepository.called, false);
    });

    it('opens the root repository instead of a submodule', async () => {
        const submodule = repository('file:///workspace/submodule');
        const discoveredRoot = repository('file:///workspace');
        const initializedRoot = repository('file:///workspace');
        const openRepository = stub().resolves(initializedRoot);
        const git = {
            repositories: [submodule, discoveredRoot],
            openRepository,
        } as unknown as API;

        const actual = await openPrimaryRepository(git, 'file:///workspace');

        assert.strictEqual(actual, initializedRoot);
        assert.strictEqual(openRepository.calledOnceWithExactly(discoveredRoot.rootUri), true);
    });

    it('normalizes a null open result to undefined', async () => {
        const discoveredRoot = repository('file:///workspace');
        const openRepository = stub().resolves(null);
        const git = {
            repositories: [discoveredRoot],
            openRepository,
        } as unknown as API;

        assert.strictEqual(await openPrimaryRepository(git, 'file:///workspace'), undefined);
        assert.strictEqual(openRepository.calledOnceWithExactly(discoveredRoot.rootUri), true);
    });
});

describe('getRepositoryForUri', () => {
    function loadGetRepositoryForUri(primaryRepository: Repository) {
        return proxyquire('./getOriginalDoc', {
            'vscode': {
                EndOfLine: {
                    LF: 1,
                    CRLF: 2,
                },
            },
            './index.activateGithubAnalyses': {
                getInitializedGitApi: async () => undefined,
                getPrimaryRepository: async () => primaryRepository,
            },
            './stringTextDocument': {
                StringTextDocument: class { },
            },
        }).getRepositoryForUri;
    }

    it('returns the initialized primary repository for a workspace file', async () => {
        const discoveredRoot = repository('file:///workspace');
        const initializedRoot = repository('file:///workspace');
        const submodule = repository('file:///workspace/submodule');
        const git = {
            repositories: [discoveredRoot, submodule],
        } as API;
        const getRepositoryForUri = loadGetRepositoryForUri(initializedRoot);

        const actual = await getRepositoryForUri(git, 'file:///workspace/src/file.ts');

        assert.strictEqual(actual, initializedRoot);
    });

    it('does not return a repository for a submodule file', async () => {
        const discoveredRoot = repository('file:///workspace');
        const initializedRoot = repository('file:///workspace');
        const submodule = repository('file:///workspace/submodule');
        const git = {
            repositories: [discoveredRoot, submodule],
        } as API;
        const getRepositoryForUri = loadGetRepositoryForUri(initializedRoot);

        const actual = await getRepositoryForUri(git, 'file:///workspace/submodule/src/file.ts');

        assert.strictEqual(actual, undefined);
    });
});
