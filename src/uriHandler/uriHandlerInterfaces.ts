// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';

/**
* Base type for URI metadata passed between windows.
*/
export type UriMetadata = ({

    /**
    * Unique run id.
    */
    operationId: string;

    /**
     * The ADO organization.
     */
    organization: string;

    /**
     * The organization project.
     */
    project: string;

    /**
     * The repository name.
     */
    repoName: string;

    /**
     * The repository uri.
     */
    repoUri: Uri;

}) & ({

    /**
     * The vulnerability title result identifier.
     */
    title: string | null;
});

export type RepoMappingMetadata = {
    operationId?: string;
    repoPath: string;
    title?: string;
}