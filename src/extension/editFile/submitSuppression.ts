// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { workspace, window, TextDocument, Range } from 'vscode';
import { Suppression } from 'sarif';
import { ResultId } from '../../shared/index';
import { decodeFileUri } from '../../shared/index';
import * as sarif from 'sarif';
import {detectJsonIndentation, find_property_at, findMatchingBrace, findMatchingBracket, SuppressionEditTpe} from './editFileUtils';

export interface updateSuppressionInfo {
    updated_suppressions: Suppression[];
    result_id: ResultId;
}

export async function updateSuppressionFile(editinfo: updateSuppressionInfo) {
    const [fileUri, runIndex, resultIndex] = editinfo.result_id;
    const uri = decodeFileUri(fileUri);
    const document = await workspace.openTextDocument(uri);

    const sarifString = document.getText();
    const spacing = detectJsonIndentation(sarifString);
    // Parse the SARIF content
    const sarifContent = JSON.parse(sarifString) as sarif.Log;
    // Find the correct run and result
    const run = sarifContent.runs[runIndex];
    const result = run.results?.[resultIndex];

    if (!result) {
        const error_msg = 'Cannot find the specified result';
        window.showErrorMessage(error_msg);
        throw new Error(error_msg);
    }

    const editor = window.visibleTextEditors.find(ed => ed.document.uri.toString() === document.uri.toString());
    if (editor) {
        const range = findSuppressionRange(document, runIndex, resultIndex);

        let newContent = JSON.stringify(editinfo.updated_suppressions, null, spacing);
        newContent = `"suppressions": ${newContent}`;
        if (range.start.isEqual(range.end)) {
            newContent = `,\n${newContent}`;
        }

        //  Apply the text edit to replace the content
        await editor.edit(editBuilder => {
            editBuilder.replace(range, newContent);
        });

        // Save the document
        await document.save();

        window.showInformationMessage('Suppression updated successfully.');
    }
    else {
        const error_msg = 'Cannot find an open editor for the SARIF file.';
        window.showErrorMessage(error_msg);
        throw new Error(error_msg);
    }
}

function findSuppressionRange(document: TextDocument, runIndex: number, resultIndex: number): Range {
    const documentText = document.getText();
    const error_msg = 'Cannot find update Location';

    // Find the result
    let pos = find_property_at(documentText, 'runs', runIndex);
    if (pos === -1) throw new Error(error_msg);

    pos = find_property_at(documentText, 'results', resultIndex, pos);
    if (pos === -1) throw new Error(error_msg);

    const resultEnd = findMatchingBrace(documentText, pos);
    if (resultEnd === -1) throw new Error(error_msg);

    const resultString = documentText.substring(pos, resultEnd);
    // put it at the end ot
    if (resultString.indexOf('"suppressions"') === -1) {
        // Move one character back to insert before the closing brace
        return new Range(document.positionAt(resultEnd - 1), document.positionAt(resultEnd - 1));
    } else {
        // Suppressions exist, place at the end of the suppressions array
        // Check if suppressions exist
        pos = documentText.indexOf(`"suppressions"`, pos);
        if (pos === -1) throw new Error(error_msg);

        return new Range(document.positionAt(pos), document.positionAt(resultEnd - 1));
    }
}
