/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import * as semver from "semver";
import { HttpsProxyAgent } from "https-proxy-agent";
import { OutgoingHttpHeaders, ClientRequest } from 'http';
import * as URL from 'url';
import { Utilities } from "../utilities";
import { GitHubRelease, GitHubApiBase, GitHubAsset } from "./gitHubInterfaces";

/**
 * The flow of this update checking is as follows.
 * Use the GitHub APIs to git a list of releases for the repository.
 * https://developer.github.com/v3/repos/releases/#list-releases-for-a-repository
 * Then look at the "tag_name" in the repositories which are created in the form
 * "v<semver>-insiders" for insiders builds.
 * Compare the semantic version of the release candidate to the extensions current version.
 * If candidate version is greater than the extension version, then find the correct assets
 * for that release and find the VSIX.
 * This is done using this GitHub API.
 * https://developer.github.com/v3/repos/releases/#list-assets-for-a-release
 * Once we find the asset with the correct "name", it is downloaded and installed.
 */

const gitHubRepo: string = 'Microsoft/sarif-vscode-extension';
const vsixAssetName: string = 'Microsoft.Sarif-Viewer.vsix';
const maxRedirectionAllowed: number = 3;
const maxNUmberOfReleasesToInspect: number = 4;

/**
 * Retrieves @see HttpsProxyAgent information that may be setup in VSCode or in the process environment
 * to use for HTTP(s) requests.
 */
function getHttpsProxyAgent(): HttpsProxyAgent | undefined {
    // See if we have an HTTP proxy set up in VSCode's proxy settings or
    // if it has been set up in the process environment.
    // NOTE: The upper and lower case versions are best attempt effort as enumerating through
    // all the environment key\value pairs to perform case insensitive compares for "http(s)_proxy"
    // would be a bit too much.
    const proxy: string | undefined = vscode.workspace.getConfiguration().get<string | undefined>('http.proxy', undefined) ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy;

    // If no proxy is defined, we're done
    if (!proxy) {
        return undefined;
    }

    const proxyUrl: URL.Url = URL.parse(proxy);

    if (!proxyUrl.protocol || (!proxyUrl.protocol.invariantEqual('https:') && !proxyUrl.protocol.invariantEqual('http:'))) {
        return undefined;
    }

    return new HttpsProxyAgent({
        port: proxyUrl.port && parseInt(proxyUrl.port, 10),
        host: proxyUrl.host,
        auth: proxyUrl.auth,
        secureProxy: vscode.workspace.getConfiguration().get('http.proxyStrictSSL', true)
    });

}

/**
 * Downloads content into a file over HTTPS.
 * @param uri The URI to download.
 * @param destinationPath  The destination path for the download.
 * @param headers Optional headers to use for the download.
 * @param redirectionCount The number of times a redirection has been attempted.
 */
async function downloadOverHttps(uri: vscode.Uri, destinationPath: vscode.Uri, headers?: OutgoingHttpHeaders, redirectionCount?: number): Promise<void> {
    if (!destinationPath.isFile()) {
        throw new Error('Destination path is expected to be a file.');
    }

    const redirectionAttempts: number = redirectionCount ?? 0;
    const requestPromise: Promise<void> = new Promise<void>((resolve, reject) => {
        const parsedUrl: URL.Url = URL.parse(uri.toString(/*skip encoding*/ true));
        const httpRequest: ClientRequest = https.request({
            headers,
            path: parsedUrl.path,
            host: parsedUrl.host,
            agent: getHttpsProxyAgent(),
            rejectUnauthorized: vscode.workspace.getConfiguration().get('http.proxyStrictSSL', true)
        }, async (response) => {
            // Handle redirection but don't let it run forever.
            if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location && redirectionAttempts < maxRedirectionAllowed) {
                resolve(downloadOverHttps(vscode.Uri.parse(response.headers.location, /*strict*/ true), destinationPath, headers, redirectionAttempts + 1));
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Update checked failed downloading from ${uri.toString(/*skip encoding*/ true)} with status code ${response.statusCode}`));
                return;
            }

            const createdFile: fs.WriteStream = fs.createWriteStream(destinationPath.fsPath);
            createdFile.on('finish', () => {
                resolve();
            });

            response.on('error', (error) => {
                reject(error);
            });

            response.pipe(createdFile);
        });

        httpRequest.on('error', (error) => {
            reject(error);
        });

        httpRequest.end();
    });

    await requestPromise;
}

/**
 * Downloads content and parses it into an object (assumes the downloaded content is JSON).
 * @param uri The URI to download.
 * @param downloadName A name (file name portion) that will be used in a temporary full path for downloading content.
 * @param headers Optional headers to use for the download.
 */
async function downloadOverHttpsAsJsonObject<T>(uri: vscode.Uri, downloadName: string, headers?: OutgoingHttpHeaders): Promise<T> {
    const downloadUri: vscode.Uri = vscode.Uri.file(Utilities.generateTempPath(downloadName));
    await downloadOverHttps(uri, downloadUri, headers);
    const jsonBuffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
        fs.readFile(downloadUri.fsPath, (err, data) => {
            err ? reject(err) : resolve(data);
        });
    });
    return <T>JSON.parse(jsonBuffer.toString());
}

/**
 * Uses GitHub release APIs to attempt to locate an acceptable release to upgrade to.
 */
async function findInsidersReleaseCandidate(): Promise<GitHubRelease | undefined> {
    const ourExtension: vscode.Extension<void> | undefined = vscode.extensions.getExtension('MS-SarifVSCode.sarif-viewer');
    if (!ourExtension) {
        throw new Error('Cannot find our own extension???');
    }

    const versionString: string | undefined = ourExtension.packageJSON.version;
    if (!versionString) {
        throw new Error('Cannot find our own extension version???');
    }

    const headers: OutgoingHttpHeaders = { 'User-Agent': 'microsoft.sarif-viewer' };
    const gitHubReleaseResponse: GitHubRelease[] = await downloadOverHttpsAsJsonObject(vscode.Uri.parse(`${GitHubApiBase}/${gitHubRepo}/releases`), 'gitHubReleases.json', headers);

    const releasesToInspect: GitHubRelease[] = gitHubReleaseResponse.slice(0, maxNUmberOfReleasesToInspect);
    for (const release of releasesToInspect) {
        if (!release.tag_name.charAt(0).invariantEqual('v')) {
            continue;
        }

        const candidateReleaseVersion: semver.SemVer = new semver.SemVer(release.tag_name.substr(1));
        if (candidateReleaseVersion.prerelease.find((tag) => typeof tag === 'string' && tag.invariantEqual('insiders')) === undefined) {
            continue;
        }

        const extensionVersion: semver.SemVer = new semver.SemVer(versionString);
        if (candidateReleaseVersion.compare(extensionVersion) <= 0) {
            continue;
        }

        return release;
    }

    return undefined;
}

/**
 * Attempts to locate a GitHub asset (which is our Download VSIX) using GitHub APIs.
 * @param release A candidate release found from @see findInsidersReleaseCandidate
 */
async function findAssetForRelease(release: GitHubRelease): Promise<GitHubAsset | undefined> {
    const headers: OutgoingHttpHeaders = { 'User-Agent': 'microsoft.sarif-viewer' };
    const gitHubAssets: GitHubAsset[] = await downloadOverHttpsAsJsonObject(vscode.Uri.parse(`${GitHubApiBase}/${gitHubRepo}/releases/${release.id}/assets`), 'githubAssets.json', headers);
    for (const asset of gitHubAssets) {
        if (asset.content_type.invariantEqual('application/octet-stream', 'Ignore Case') &&
            asset.name.invariantEqual(vsixAssetName, 'Ignore Case')) {
                return asset;
        }
    }

    return undefined;
}

/**
 * Downloads the VSIX.
 * @param asset The GitHub asset to download.
 */
async function tryDownloadVsix(asset: GitHubAsset): Promise<vscode.Uri | undefined> {
    const vsixDownloadUri: vscode.Uri = vscode.Uri.file(Utilities.generateTempPath(vsixAssetName));

    // Save VSCode's proxy support setting. This is done because
    // we attempt two download the VSIX with and without VSCode's
    // proxy support.
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
    const originalProxySupport: string | undefined = config.inspect<string>('http.proxySupport')?.globalValue;
    let restoreVSCodeProxySetting: boolean = false;

    try {
        let tryAgain: boolean = true;
        while (tryAgain) {
            try {
                await downloadOverHttps(vscode.Uri.parse(asset.browser_download_url, /*strict*/ true), vsixDownloadUri);
                return vsixDownloadUri;
            } catch {
                // If we failed to download, then turn off VSCode's proxy support (if it's not already off)
                // and try again.
                if (config.get('http.proxySupport', undefined) !== 'off' && originalProxySupport !== 'off') {
                    await config.update('http.proxySupport', 'off', true);
                    restoreVSCodeProxySetting = true;
                    continue;
                }

                tryAgain = false;
            }
        }
    } finally {
        if (restoreVSCodeProxySetting) {
            await config.update('http.proxySupport', originalProxySupport, true); // Reset the http.proxySupport.
        }
    }

    return undefined;
}

/**
 * Checks GitHub for an insiders update.
 */
export async function checkForInsiderUpdates(): Promise<void> {
    const gitHubRelease: GitHubRelease | undefined = await findInsidersReleaseCandidate();
    if (!gitHubRelease) {
        return;
    }

    const gitHubAsset: GitHubAsset | undefined = await findAssetForRelease(gitHubRelease);
    if (!gitHubAsset) {
        return;
    }

    const vsixUri: vscode.Uri | undefined = await tryDownloadVsix(gitHubAsset);
    if (!vsixUri) {
        return;
    }

    await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri);
}
