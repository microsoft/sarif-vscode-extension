// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { AnalysisInfo, getInitializedGitApi } from './index.activateGithubAnalyses';
import { StringTextDocument } from './stringTextDocument';

// TOOD: Consider caching the retval.
export async function getOriginalDoc(
    analysisInfo: AnalysisInfo | undefined,
    currentDoc: { uri: Uri })
    : Promise<StringTextDocument | undefined> {

    if (!analysisInfo) return undefined;

    const git = await getInitializedGitApi();
    const repo = git?.repositories[0];
    if (!repo) return undefined;

    const scannedFile = await repo.show(analysisInfo.commit_sha, currentDoc.uri.fsPath);
    return new StringTextDocument(scannedFile);
}
