// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable filenames/match-regex */

import { IArraySplice, observe } from 'mobx';
import { Log } from 'sarif';
import { Disposable, languages, Range, ThemeColor, window } from 'vscode';
import { parseArtifactLocation } from '../shared';
import '../shared/extension';
import { regionToSelection } from './regionToSelection';
import { ResultDiagnostic } from './resultDiagnostic';
import { Store } from './store';

// Decorations are for Analysis Steps.
export function activateDecorations(disposables: Disposable[], store: Store) {
    const decorationTypeCallout = window.createTextEditorDecorationType({
        after: { color: new ThemeColor('problemsWarningIcon.foreground') }
    });
    const decorationTypeHighlight = window.createTextEditorDecorationType({
        border: '1px',
        borderStyle: 'solid',
        borderColor: new ThemeColor('problemsWarningIcon.foreground'),
    });
    disposables.push(languages.registerCodeActionsProvider('*', {
        provideCodeActions: (doc, _range, context) => {
            if (context.only) return;

            const diagnostic = context.diagnostics[0] as ResultDiagnostic | undefined;
            if (!diagnostic) return;

            const result = diagnostic?.result;
            if (!result) return; // Don't clear the decorations until the next result is selected.

            const editor = window.visibleTextEditors.find(editor => editor.document === doc);
            if (!editor) return; // When would editor be undef?

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

            return [];
        }
    }));
    const disposer = observe(store.logs, change => {
        const {removed} = change as unknown as IArraySplice<Log>;
        if (!removed.length) return;
        window.visibleTextEditors.forEach(editor => {
            editor.setDecorations(decorationTypeCallout, []);
            editor.setDecorations(decorationTypeHighlight, []);
        });
    });
    disposables.push({ dispose: disposer });
}
