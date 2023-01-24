// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { UriPath } from './enums/uriPath';

export enum UriAction {
    RunComponentGovernanceScan = 'runComponentGovernanceScan',
    RunOpenFile = 'runOpenFile',
    None = 'none'
}

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

}) & ({

    /**
    * The type of the URI metadata.
    */
    type: UriPath.ComponentGovernance;

    /**
     * The expected behavior of this URI call.
     */
    action: UriAction.RunComponentGovernanceScan;

    /**
     * The vulnerability title result identifier.
     */
    title: string | null;
} | {

    /**
    * The type of the URI metadata.
    */
    type: UriPath.SecCode;

    /**
     * The expected behavior of this URI call.
     */
    action: UriAction.RunOpenFile;
    commentThreadBody?: string;
    commentThreadLabel?: string;
    commentThreadName?: string;
    openFileLineNumber: number;
    openFileRelativePath: string;
});

export type RepoMappingMetadata = {
    action: UriAction;
    commentThreadBody?: string;
    commentThreadLabel?: string;
    commentThreadName?: string;
    openFileLineNumber?: number;
    openFileRelativePath?: string;
    operationId?: string;
    repoPath: string;
    title?: string;
}