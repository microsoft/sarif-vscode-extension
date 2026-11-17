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
const { selectLatestAnalysesPerCategory, parseNextLinkUrl } = proxyquire('./index.activateGithubAnalyses', {
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

    it('dedupes by tool.name when category is absent', () => {
        const analyses = [
            { id: 2, commit_sha: commitSha, created_at: '2024-01-01T02:00:00Z', tool: { name: 'ESLint' }, results_count: 1 },
            { id: 1, commit_sha: commitSha, created_at: '2024-01-01T01:00:00Z', tool: { name: 'ESLint' }, results_count: 1 },
        ];

        const result = selectLatestAnalysesPerCategory(analyses, commitSha);

        assert.deepStrictEqual(result.map((a: any) => a.id), [2]);
    });

    // GitHub only treats a new upload as superseding an earlier one when BOTH tool and category
    // match, so two different tools can legitimately share the same category string. Deduping by
    // category alone would incorrectly collapse these into a single analysis, silently dropping one
    // tool's results.
    it('keeps both analyses when different tools share the same category', () => {
        const analyses = [
            { id: 2, commit_sha: commitSha, created_at: '2024-01-01T02:00:00Z', tool: { name: 'ESLint' }, results_count: 1, category: '/language:javascript' },
            { id: 1, commit_sha: commitSha, created_at: '2024-01-01T01:00:00Z', tool: { name: 'CodeQL' }, results_count: 1, category: '/language:javascript' },
        ];

        const result = selectLatestAnalysesPerCategory(analyses, commitSha);

        assert.deepStrictEqual(result.map((a: any) => a.id).sort(), [1, 2]);
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

describe('parseNextLinkUrl', () => {
    it('returns undefined when the header is missing', () => {
        assert.strictEqual(parseNextLinkUrl(null), undefined);
        assert.strictEqual(parseNextLinkUrl(undefined), undefined);
        assert.strictEqual(parseNextLinkUrl(''), undefined);
    });

    it('extracts the rel="next" url amongst other rels', () => {
        const linkHeader = '<https://api.github.com/repos/o/r/code-scanning/analyses?page=2>; rel="next", '
            + '<https://api.github.com/repos/o/r/code-scanning/analyses?page=5>; rel="last"';

        assert.strictEqual(parseNextLinkUrl(linkHeader), 'https://api.github.com/repos/o/r/code-scanning/analyses?page=2');
    });

    it('returns undefined when there is no next page (last page reached)', () => {
        const linkHeader = '<https://api.github.com/repos/o/r/code-scanning/analyses?page=1>; rel="prev", '
            + '<https://api.github.com/repos/o/r/code-scanning/analyses?page=1>; rel="first"';

        assert.strictEqual(parseNextLinkUrl(linkHeader), undefined);
    });
});
