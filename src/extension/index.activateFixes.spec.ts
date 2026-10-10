// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable filenames/match-regex */
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from 'assert';

const proxyquire = require('proxyquire').noCallThru();

function getCodeActions(properties?: Record<string, unknown>) {
    let provider: any;
    class CodeAction {
        command: unknown;
        diagnostics: unknown;
        readonly title: string;

        constructor(title: string) {
            this.title = title;
        }
    }
    const { activateFixes } = proxyquire('./index.activateFixes', {
        'vscode': {
            CodeAction,
            CodeActionKind: {
                Empty: {},
                QuickFix: {},
            },
            languages: {
                registerCodeActionsProvider: (_selector: unknown, value: unknown) => {
                    provider = value;
                    return {};
                },
            },
        },
        './getOriginalDoc': {
            getOriginalDoc: async () => undefined,
        },
        './index.activateGithubAnalyses': {
            getInitializedGitApi: async () => undefined,
        },
        './regionToSelection': {
            driftedRegionToSelection: () => undefined,
        },
        './resultDiagnostic': {
            ResultDiagnostic: class {},
        },
    });
    activateFixes([], { resultsFixed: [] } as any, {} as any);
    return provider.provideCodeActions(undefined, undefined, {
        diagnostics: [{
            result: {
                properties,
            },
        }],
    });
}

describe('activateFixes', () => {
    it('does not offer GitHub dismissal actions without an alert number', () => {
        const actions = getCodeActions();

        assert.deepStrictEqual(actions.map((action: { title: string }) => action.title), ['Mark as fixed']);
    });

    it('offers GitHub dismissal actions for numeric alert numbers', () => {
        const actions = getCodeActions({ 'github/alertNumber': 42 });

        assert.deepStrictEqual(actions.map((action: { title: string }) => action.title), [
            'Mark as fixed',
            'Dismiss - False Positive',
            'Dismiss - Used in Tests',
            'Dismiss - Won\'t Fix',
        ]);
    });
});
