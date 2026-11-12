// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { API, Repository } from './git';

export async function openPrimaryRepository(
    git: API,
    primaryWorkspaceFolderUriString: string | undefined,
): Promise<Repository | undefined> {
    if (!primaryWorkspaceFolderUriString) return undefined;

    const repository = git.repositories
        .find(repo => repo.rootUri.toString() === primaryWorkspaceFolderUriString);
    if (!repository) return undefined;

    return await git.openRepository(repository.rootUri) ?? undefined;
}
