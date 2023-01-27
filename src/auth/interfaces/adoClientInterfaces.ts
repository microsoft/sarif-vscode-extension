// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AdoSearchResponse {
    count: number;
    results: AdoResults[];
    infoCode: number;
    facets?: any;
}

export interface AdoResults {
    fileName: string;
    path: string;
    matches: Matches;
    collection: Collection;
    project: Project;
    repository: Repository;
    versions: Version[];
    contentId: string;
    organization?: string;
    localRoot?: string;
}

interface Version {
    branchName: string;
    changeId: string;
}

interface Repository {
    name: string;
    id: string;
    type: string;
}

interface Project {
    name: string;
    id: string;
}

interface Collection {
    name: string;
}

interface Matches {
    content: Content[];
    fileName: FileName[];
}

interface FileName {
    charOffset: number;
    length: number;
    line: number;
    column: number;
    codeSnippet?: any;
    type?: any;
}

export interface Content {
    charOffset: number;
    length: number;
    line: number;
    column: number;
    codeSnippet?: any;
    type: string;
}

export interface AdoAccount {
    accountId: string;
    accountUri: string;
    accountName: string;
    properties: any;
}

export interface IndexedBranch {
    name: string;
    lastIndexedChangeId: string;
    lastProcessedTime: string;
}

export interface AdoFavoriteRepository {
    artifactName: string;
    artifactId: string;
}

export interface AdoFavoriteRepositoryResponse {
    count: number;
    value: AdoFavoriteRepository[];
}
