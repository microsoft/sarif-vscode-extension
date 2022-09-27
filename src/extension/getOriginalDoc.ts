// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { AnalysisInfo, getInitializedGitApi, getPrimaryRepository } from './index.activateGithubAnalyses';
import { StringTextDocument } from './stringTextDocument';

// TODO: Consider caching the retval.
export async function getOriginalDoc(
    analysisInfo: AnalysisInfo | undefined,
    currentDoc: { uri: Uri })
    : Promise<StringTextDocument | undefined> {

    if (!analysisInfo) return undefined;

    const git = await getInitializedGitApi();
    if (!git) return undefined;

    const repo = getPrimaryRepository(git);
    if (!repo) return undefined;

    const scannedFile = await repo.show(analysisInfo.commit_sha, currentDoc.uri.fsPath);
    return new StringTextDocument(scannedFile);
}
