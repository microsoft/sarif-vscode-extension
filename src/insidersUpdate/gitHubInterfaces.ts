/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

/**
 * For reference, you can find the GitHub API information here:
 * https://developer.github.com/v3/repos/
 * Yes, there are "node packages" from just about everyone but they are
 * way overkill for what we need. These interfaces are the bare-minimum
 * needed for us to perform our upgrade checks and installs.
 * This implementation was adapted from the Microsoft C/C++ extension.
 * https://github.com/microsoft/vscode-cpptools/blob/58c50dc38b1a3ebcae8139b28c0904d468d11e6e/Extension/src/githubAPI.ts
 */

export const GitHubApiBase: string = 'https://api.github.com';

 /**
  * Contains the minimum information needed to inspect a git-hub release.
  */
export interface GitHubRelease {
    /**
     * The tag name for the release in the form of v<semver>-insiders.
     * I.e. v3.2020.424006-insiders
     */
    readonly tag_name: string;

    /**
     * The Git Hub release ID.
     */
    readonly id: number;

    /**
     * The URL for the asset which will be used to download the extension.
     */
    readonly assets_url: string;
}

 /**
  * Contains the minimum information needed to inspect a git-hub asset.
  */
 export interface GitHubAsset {

    /**
     * The URI of the asset to download.
     */
    readonly browser_download_url: string;

    /**
     * We expect this to be "application/octet-stream"
     */
    readonly content_type: string;

    /**
     * The name of the asset.
     * Should be Microsoft.Sarif-Viewer.vsix.
     */
    readonly name: string;
}

/**
 * Rate limit information from GitHub.
 */
export interface GitHubRateLimit {
    /**
     * The total rate-limit.
     */
    limit: number;

    /**
     * The number of queries we have remaining.
     */
    remaining: number;

    /**
     * The time at which the rate-limit resets.
     */
    reset: number;
}

/**
 * The rate limits for different GitHub resources.
 * We only use the core one.
 */
export interface GitHubRateResources {
    core: GitHubRateLimit;
}

/**
 * Contains the response from https://developer.github.com/v3/rate_limit/
 */
export interface GitHubRateLimitResponse {
    resources: GitHubRateResources;
}
