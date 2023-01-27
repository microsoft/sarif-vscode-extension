// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable no-magic-numbers */

import * as fs from 'fs';
import { Build, BuildQueryOrder } from 'azure-devops-node-api/interfaces/BuildInterfaces';
import { GitVersionDescriptor, GitVersionType } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { AdoSearchResponse } from './interfaces/adoClientInterfaces';
import { BuildApi } from 'azure-devops-node-api/BuildApi';
import { GitApi } from 'azure-devops-node-api/GitApi';
import { GitRepository } from 'azure-devops-node-api/interfaces/TfvcInterfaces';
import { WebApi } from 'azure-devops-node-api';
import { WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { WorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import extract from 'extract-zip';
import { getConnection } from './authenticationHandler';

/**
 * Converts a readable stream to a string.
 * @param {NodeJS.ReadableStream} stream The readable stream.
 * @returns {Promise<string>}  The string conversion.
 */
export function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: any[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk) =>
            chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () =>
            resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

/**
 * Formats a string to remove zero width characters.
 * @param {string} str The string to format.
 * @returns {string}  The final string.
 */
export function removeZeroWidthCharactersFromString(str: string): string {
    // eslint-disable-next-line require-unicode-regexp
    return str.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Gets the ADO file contents.
 * @param {string} organization The organization to get the file contents from.
 * @param {string} repoId The repository id.
 * @param {string} branchName The branch name.
 * @param {string} path The file path.
 * @param {string} commitId The file commit id.
 * @returns {Promise<string>}  The stream contents.
 */
export async function getAdoFileContent(
    organization: string,
    repoId: string,
    branchName: string,
    path: string,
    commitId?: string
): Promise<string> {
    const connection: WebApi = await getConnection(organization);
    const git: GitApi = await connection.getGitApi();

    let versionDescriptor: GitVersionDescriptor;

    if (commitId) {
        versionDescriptor = {
            version: commitId,
            versionType: GitVersionType.Commit
        };
    } else {
        const sanitizeBranchName = branchName.replace('refs/heads/', '');
        versionDescriptor = {
            version: sanitizeBranchName,
            versionType: GitVersionType.Branch
        };
    }

    const content: NodeJS.ReadableStream = await git.getItemContent(
        repoId,
        path,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        versionDescriptor
    );

    const stringFrom: string = await streamToString(content);
    return removeZeroWidthCharactersFromString(stringFrom);
}

/**
 * Downloads ADO repo content.
 * @param {string} organization The organization to get the file contents from.
 * @param {string} repoId The repository id.
 * @param {string} repoPath The file path.
 * @param {string} downloadPath The path to download the file to.
 * @param {string} extractLocationDirectory The directory to extract the downloaded zip content to.
 * @param {string} expectedDownloadPath The expected downloaded content path.
 * @returns {Promise<string | undefined>} The path to the downloaded content or undefined.
 */
export async function downloadAdoFile(
    organization: string,
    repoId: string,
    repoPath: string,
    downloadPath: string,
    extractLocationDirectory: string,
    expectedDownloadPath: string
): Promise<string | undefined> {
    const connection: WebApi = await getConnection(organization);
    const git: GitApi = await connection.getGitApi();

    try {
        // Get the ADO item zipped content.
        const download: NodeJS.ReadableStream = await git.getItemZip(
            repoId,
            repoPath
        );

        // Download the zipped content to the specified location path.
        const fileStream: fs.WriteStream = fs.createWriteStream(downloadPath);
        download.pipe(fileStream);

        const closePromise: Promise<void> = new Promise((resolve) => {
            fileStream.on('close', () => {
                // zippedContentDownloaded
                resolve();
            });
        });

        await closePromise;
        await extract(
            downloadPath,
            {
                dir: extractLocationDirectory
            }
        );

        // Verify that our extract succeeded by checking that the extract directory exists and the expected download file path exists.
        if (fs.existsSync(extractLocationDirectory) && fs.existsSync(expectedDownloadPath)) {
            return expectedDownloadPath;
        }
    } catch (error) {
        // errorOccurredDuringDownloadAdoContent
    }

    return undefined;
}

/**
 * Downloads ADO pipeline artifacts.
 * @param {string} organization The organization to get the file contents from.
 * @param {string} project The ADO project.
 * @param {string} buildId The build id.
 * @param {string} artifactName The artifact name.
 * @param {string} downloadPath The path to download the file to.
 * @param {string} extractLocationDirectory The directory to extract the downloaded zip content to.
 * @returns {Promise<string | undefined>} The path to the downloaded content or undefined.
 */
export async function downloadPipelineArtifacts(
    organization: string,
    project: string,
    buildId: number,
    artifactName: string,
    downloadPath: string,
    extractLocationDirectory: string
): Promise<void> {
    const connection: WebApi = await getConnection(organization);
    const buildApi: BuildApi = await connection.getBuildApi();

    const download: NodeJS.ReadableStream = await buildApi.getArtifactContentZip(project, buildId, artifactName);
    // Download the zipped content to the specified location path.
    const fileStream: fs.WriteStream = fs.createWriteStream(downloadPath);
    download.pipe(fileStream);

    const closePromise: Promise<void> = new Promise((resolve) => {
        fileStream.on('close', () => {
            // zippedContentDownloaded
            resolve();
        });
    });

    await closePromise;
    await extract(
        downloadPath,
        {
            dir: extractLocationDirectory
        }
    );
}

/**
 * Gets a repository id given a repo name.
 * @param {string} organization The organization to get the file contents from.
 * @param {string} project The ADO project.
 * @param {string} repoName The repository name.
 * @returns {Promise<string | undefined>} The repo id or undefined.
 */
export async function getRepoId(organization: string, project: string, repoName: string): Promise<string | undefined> {
    const connection: WebApi = await getConnection(organization);
    const gitApi: GitApi = await connection.getGitApi();

    const repositories: GitRepository[] = await gitApi.getRepositories(project);
    const repoNames: (string | undefined)[] = repositories.map((repo) =>
        repo.name);

    if (repoNames.length < 1) {
        return undefined;
    }

    const filteredRepos: GitRepository[] = repositories.filter((repo) =>
        repo.name === repoName);

    if (filteredRepos.length > 0) {
        return filteredRepos[0].id;
    }

    return undefined;
}

/**
 * Gets the list of builds for a given repository id.
 * @param {string} organization The organization to get the file contents from.
 * @param {string} project The ADO project.
 * @param {string} repoId The repository id.
 * @param {string} branchName The current repository branch.
 * @param {string} repositoryType The repository type. Default is TfsGit.
 * @param {number} top The top number of build results to show. Default is 5.
 * @returns {Promise<Build[]>} The failed builds.
 */
export async function getRepoBuilds(organization: string, project: string, repoId: string, branchName?: string, repositoryType = 'TfsGit', top = 5): Promise<Build[]> {
    const connection: WebApi = await getConnection(organization);
    const buildApi: BuildApi = await connection.getBuildApi();
    const builds: Build[] = await buildApi.getBuilds(
        project,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        top,
        undefined,
        undefined,
        undefined,
        BuildQueryOrder.FinishTimeDescending,
        branchName,
        undefined,
        repoId,
        repositoryType
    );

    return builds;
}

/**
 * Gets a workitem and its metadata within a specific ADO organization.
 * @param {string} organization The organization to get the file contents from.
 * @param {string} workItemId The work item id.
 * @returns {Promise<WorkItem | undefined>} The work item.
 */
export async function getWorkItem(organization: string, workItemId: string): Promise<WorkItem | undefined> {
    const connection: WebApi = await getConnection(organization);
    const workItemTrackingApi: WorkItemTrackingApi = await connection.getWorkItemTrackingApi();
    const workItem: WorkItem | undefined = await workItemTrackingApi.getWorkItem(parseInt(workItemId, 10));
    return workItem;
}

/**
 * Performs an ADO code search on a given query string.
 * @param {string} query The search query.
 * @param {string} organization The organization to get the file contents from.
 * @param {string} project The ADO project.
 * @returns {Promise<AdoSearchResponse | undefined>} The ADO code search response.
 */
export async function searchCode(query: string, organization: string, project: string): Promise<AdoSearchResponse | undefined> {
    const url = `https://almsearch.dev.azure.com/${organization}/${project}/_apis/search/codesearchresults?api-version=7.0`;
    const connection: WebApi = await getConnection(organization);

    // eslint-disable-next-line @typescript-eslint/ban-types
    const body: object = {
        $orderBy: [],
        $skip: 0,
        $top: 100,
        filters: {

        },
        includeFacets: false,
        searchText: query
    };

    const response = await connection.rest.create<AdoSearchResponse>(url, body);
    return response.result ?? undefined;
}
