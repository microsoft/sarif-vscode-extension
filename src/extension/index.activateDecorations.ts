// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { IArraySplice, observable, observe } from 'mobx';
import { Log } from 'sarif';
import { Disposable, languages, Range, ThemeColor, window } from 'vscode';
import { findResult, parseArtifactLocation, ResultId } from '../shared';
import '../shared/extension';
import { regionToSelection } from './regionToSelection';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';

// Decorations are for Analysis Steps.
export function activateDecorations(disposables: Disposable[], store: Store) {
    // Navigating away from a diagnostic/result will not clear the `activeResultId`.
    // This keeps the decorations "pinned" while users navigate the thread flow steps.
    const activeResultId = observable.box<string | undefined>();

    const decorationTypeCallout = window.createTextEditorDecorationType({
        after: { color: new ThemeColor('problemsWarningIcon.foreground') }
    });
    const decorationTypeHighlight = window.createTextEditorDecorationType({
        border: '1px',
        borderStyle: 'solid',
        borderColor: new ThemeColor('problemsWarningIcon.foreground'),
    });

    // On selection change, set the `activeResultId`.
    disposables.push(languages.registerCodeActionsProvider('*', {
        provideCodeActions: (_doc, _range, context) => {
            if (context.only) return;

            const diagnostic = context.diagnostics[0] as ResultDiagnostic | undefined;
            if (!diagnostic) return;

            const result = diagnostic?.result;
            if (!result) return; // Don't clear the decorations. See `activeResultId` comments.

            activeResultId.set(JSON.stringify(result._id)); // Stringify for comparability.

            // Technically should be using `onDidChangeTextEditorSelection` and `languages.getDiagnostics`
            // then manually figuring with diagnostics are at the caret. However `languages.registerCodeActionsProvider`
            // provides the diagnostics for free. The only odd part is that we always return [] when `provideCodeActions` is called.
            return [];
        }
    }));

    // Update decorations on:
    // * `activeResultId` change
    // * `window.visibleTextEditors` change
    // * `store.logs` item removed
    //    We don't trigger on log added as the user would need to select a result first.
    function update() {
        const resultId = activeResultId.get();
        if (!resultId) {
            // This code path is only expected if `activeResultId` has not be set yet. See `activeResultId` comments.
            // Thus we are not concerned with clearing any previously rendered decorations.
            return;
        }
        const result = findResult(store.logs,JSON.parse(resultId) as ResultId);
        if (!result) {
            // Only in rare cases does `findResult` fail to resolve a `resultId` into a `result`.
            // Such as if a log were closed after an `activeResultId` was set.
            return;
        }

        for (const editor of window.visibleTextEditors) {
            const doc = editor.document;
            const locations = result.codeFlows?.[0]?.threadFlows?.[0]?.locations ?? [];

            const docUriString = doc.uri.toString();
            const locationsInDoc = locations.filter(tfl => {
                const [artifactUriString] = parseArtifactLocation(result, tfl.location?.physicalLocation?.artifactLocation);
                return docUriString === artifactUriString;
            });

            const ranges = locationsInDoc.map(tfl => regionToSelection(doc, tfl.location?.physicalLocation?.region));
            editor.setDecorations(decorationTypeHighlight, ranges);

            { // Sub-scope for callouts.
                const messages = locationsInDoc.map((tfl) => {
                    const text = tfl.location?.message?.text;
                    return `Step ${locations.indexOf(tfl) + 1}${text ? `: ${text}` : ''}`;
                });
                const rangesEnd = ranges.map(range => {
                    const endPos = doc.lineAt(range.end.line).range.end;
                    return new Range(endPos, endPos);
                });
                const rangesEndAdj = rangesEnd.map(range => {
                    const tabCount = doc.lineAt(range.end.line).text.match(/\t/g)?.length ?? 0;
                    const tabCharAdj = tabCount * (editor.options.tabSize as number - 1); // Intra-character tabs are counted wrong.
                    return range.end.character + tabCharAdj;
                });
                const maxRangeEnd = Math.max(...rangesEndAdj) + 2; // + for Padding
                const decorCallouts = rangesEnd.map((range, i) => ({
                    range,
                    hoverMessage: messages[i],
                    renderOptions: { after: { contentText: ` ${'┄'.repeat(maxRangeEnd - rangesEndAdj[i])} ${messages[i]}`, } }, // ←
                }));
                editor.setDecorations(decorationTypeCallout, decorCallouts);
            }
        }
    }

    disposables.push({ dispose: observe(activeResultId, update) });
    disposables.push(window.onDidChangeVisibleTextEditors(update));
    disposables.push({ dispose: observe(store.logs, change => {
        const {removed} = change as unknown as IArraySplice<Log>;
        if (!removed.length) return;
        window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(decorationTypeCallout, []);
            editor.setDecorations(decorationTypeHighlight, []);
        });
    }) });
}
