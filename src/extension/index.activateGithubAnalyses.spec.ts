// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

/* eslint-disable @typescript-eslint/no-explicit-any */ // Allowing any for mocks.

import assert from 'assert';
import { mockVscode } from '../test/mockVscode';

const proxyquire = require('proxyquire').noCallThru();

// `index.activateGithubAnalyses.ts` (and its transitive imports, e.g. `uriRebaser.ts`) depend on
// modules only available in the VS Code extension host / Node runtime (vscode, chokidar, mobx,
// node-fetch). Stub them out, using `@global` so the `vscode` stub also satisfies nested `require`s,
// so we can unit test the pure `selectLatestAnalysesPerCategory` helper in isolation.
const { selectLatestAnalysesPerCategory } = proxyquire('./index.activateGithubAnalyses', {
    'chokidar': { watch: () => ({}) },
    'mobx': { observe: () => { } },
    'node-fetch': { default: () => { }, Response: class { } },
    'vscode': {
        '@global': true,
        ...mockVscode,
    },
});

describe('selectLatestAnalysesPerCategory', () => {
    const commitSha = 'abc123';

    // Reproduces https://github.com/microsoft/sarif-vscode-extension/issues/605 and
    // https://github.com/microsoft/sarif-vscode-extension/issues/463#issuecomment-1279638232:
    // a CodeQL default-setup scan uploads one analysis per language, all sharing tool.name "CodeQL"
    // but each with a distinct category. Only the most recently uploaded one used to survive.
    it('keeps one analysis per category, even when multiple categories share the same tool name', () => {
        const analyses = [
            // GitHub returns analyses most-recent-first.
            { id: 3, commit_sha: commitSha, created_at: '2024-01-01T03:00:00Z', tool: { name: 'CodeQL' }, results_count: 1, category: '/language:javascript' },
            { id: 2, commit_sha: commitSha, created_at: '2024-01-01T02:00:00Z', tool: { name: 'CodeQL' }, results_count: 1, category: '/language:java' },
            { id: 1, commit_sha: commitSha, created_at: '2024-01-01T01:00:00Z', tool: { name: 'CodeQL' }, results_count: 1, category: '/language:actions' },
        ];

        const result = selectLatestAnalysesPerCategory(analyses, commitSha);

        assert.deepStrictEqual(result.map((a: any) => a.id), [3, 2, 1]);
    });

    it('keeps only the most recent analysis when the same category is uploaded more than once', () => {
        const analyses = [
            { id: 2, commit_sha: commitSha, created_at: '2024-01-01T02:00:00Z', tool: { name: 'CodeQL' }, results_count: 5, category: '/language:java' },
            { id: 1, commit_sha: commitSha, created_at: '2024-01-01T01:00:00Z', tool: { name: 'CodeQL' }, results_count: 4, category: '/language:java' },
        ];

        const result = selectLatestAnalysesPerCategory(analyses, commitSha);

        assert.deepStrictEqual(result.map((a: any) => a.id), [2]);
    });

    it('falls back to tool.name when category is absent', () => {
        const analyses = [
            { id: 2, commit_sha: commitSha, created_at: '2024-01-01T02:00:00Z', tool: { name: 'ESLint' }, results_count: 1 },
            { id: 1, commit_sha: commitSha, created_at: '2024-01-01T01:00:00Z', tool: { name: 'ESLint' }, results_count: 1 },
        ];

        const result = selectLatestAnalysesPerCategory(analyses, commitSha);

        assert.deepStrictEqual(result.map((a: any) => a.id), [2]);
    });

    it('excludes analyses for other commits', () => {
        const analyses = [
            { id: 2, commit_sha: 'other-commit', created_at: '2024-01-01T02:00:00Z', tool: { name: 'CodeQL' }, results_count: 1, category: '/language:java' },
            { id: 1, commit_sha: commitSha, created_at: '2024-01-01T01:00:00Z', tool: { name: 'CodeQL' }, results_count: 1, category: '/language:java' },
        ];

        const result = selectLatestAnalysesPerCategory(analyses, commitSha);

        assert.deepStrictEqual(result.map((a: any) => a.id), [1]);
    });
});
