// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { EndOfLine, Uri } from 'vscode';
import { AnalysisInfo, getInitializedGitApi, getPrimaryRepository } from './index.activateGithubAnalyses';
import { StringTextDocument } from './stringTextDocument';

// Used to force the original doc line endings to match the current doc.
function coerceLineEndings(text: string, eol: EndOfLine) {
    if (eol === EndOfLine.LF)   return text.replace(/\r\n/g,   '\n');
    if (eol === EndOfLine.CRLF) return text.replace(/\n/g  , '\r\n');
    return text;
}

// TODO: Consider caching the retval.
export async function getOriginalDoc(
    analysisInfo: AnalysisInfo | undefined,
    currentDoc: { uri: Uri, eol: EndOfLine })
    : Promise<StringTextDocument | undefined> {

    if (!analysisInfo) return undefined;

    const git = await getInitializedGitApi();
    if (!git) return undefined;

    const repo = getPrimaryRepository(git);
    if (!repo) return undefined;

    const scannedFile = await repo.show(analysisInfo.commit_sha, currentDoc.uri.fsPath);
    return new StringTextDocument(coerceLineEndings(scannedFile, currentDoc.eol));
}
