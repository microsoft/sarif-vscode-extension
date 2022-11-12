// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { EndOfLine, Uri } from 'vscode';
import { API, Repository } from './git';
import { getInitializedGitApi, getPrimaryRepository } from './index.activateGithubAnalyses';
import { StringTextDocument } from './stringTextDocument';

// If a uri belongs to a sub-module, we will not have the commit-info to make use of the repo.
// Thus we act like the repo doesn't exist (which causes downstream code to bypass anti-drifting).
export function getRepositoryForUri(git: API, uri: string): Repository | undefined {
    const primaryRepo = getPrimaryRepository(git);
    const submoduleRepos = git.repositories
        .filter(repo => repo.rootUri.toString() !== primaryRepo?.rootUri.toString());
    const uriIsInSubmodule = submoduleRepos.some(repo => uri.startsWith(repo.rootUri.toString()));
    if (uriIsInSubmodule) return undefined;
    return  primaryRepo;
}

// Used to force the original doc line endings to match the current doc.
function coerceLineEndings(text: string, eol: EndOfLine) {
    if (eol === EndOfLine.LF)   return text.replace(/\r\n/g,   '\n');
    if (eol === EndOfLine.CRLF) return text.replace(/\n/g  , '\r\n');
    return text;
}

// TODO: Consider caching the retval.
export async function getOriginalDoc(
    commitSha: string | undefined,
    currentDoc: { uri: Uri, eol: EndOfLine })
    : Promise<StringTextDocument | undefined> {

    if (!commitSha) return undefined;

    const git = await getInitializedGitApi();
    if (!git) return undefined;

    const repo = getRepositoryForUri(git, currentDoc.uri.toString());

    if (!repo) return undefined;

    const scannedFile = await repo.show(commitSha, currentDoc.uri.fsPath);
    return new StringTextDocument(coerceLineEndings(scannedFile, currentDoc.eol));
}
