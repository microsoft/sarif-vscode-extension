/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

/**
 * For reference, you can find the GitHub API information here:
 * https://developer.github.com/v3/repos/
 */

export const GitHubApiBase: string = 'https://api.github.com/repos';

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
