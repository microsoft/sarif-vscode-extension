// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { https as redirectableHttps } from 'follow-redirects';
import fs from 'fs';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { gt } from 'semver';
import { tmpNameSync } from 'tmp';
import { parse as urlParse } from 'url';
import { commands, extensions, Uri, window, workspace } from 'vscode';

interface GitHubAsset {
    content_type: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    assets: GitHubAsset[];
}

/**
 * Retrieves @see HttpsProxyAgent information that may be setup in VSCode or in the process environment
 * to use for HTTP(s) requests.
 */
function getHttpsProxyAgent() {
    // See if we have an HTTP proxy set up in VSCode's proxy settings or
    // if it has been set up in the process environment.
    // NOTE: The upper and lower case versions are best attempt effort as enumerating through
    // all the environment key\value pairs to perform case insensitive compares for "http(s)_proxy"
    // would be a bit too much.
    const proxy = workspace.getConfiguration().get<string | undefined>('http.proxy', undefined) ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy;
    if (!proxy) { // If no proxy is defined, we're done
        return undefined;
    }

    const { protocol, port, host, auth } = urlParse(proxy); // TODO: Consider migrating to to URL?
    if (!protocol || (protocol !== 'https:' && protocol !== 'http:')) {
        return undefined;
    }

    return new HttpsProxyAgent({
        port: port && +port,
        host: host,
        auth: auth,
        secureProxy: workspace.getConfiguration().get('http.proxyStrictSSL', true)
    });
}

export const updateChannelConfigSection = 'updateChannel';
const extensionName = 'sarif-viewer';
let updateInProgress = false;

function isUpdateEnabled() {
    const updateChannel = workspace.getConfiguration(extensionName).get<string>(updateChannelConfigSection, 'Default');
    return updateChannel === 'Insiders';
}

/** Determine if a newer version of this extension exists and install it. Useful for off-marketplace release channels. */
// TODO: Handle/test http proxies.
export async function update() {
    if (updateInProgress) return false;
    updateInProgress = true;
    if (!isUpdateEnabled()) return false;

    const extensionFullName = `MS-SarifVSCode.${extensionName}`;
    const installedVersion = extensions.getExtension(extensionFullName)!.packageJSON.version;
    const agent = getHttpsProxyAgent();

    const success = await (async () => {
        try {
            // 1) Find the right release from the list.
            const releasesResponse = await fetch('https://api.github.com/repos/Microsoft/sarif-vscode-extension/releases', { agent });
            if (releasesResponse.status !== 200) return false;
            const releases = await releasesResponse.json() as GitHubRelease[];
            const release = releases.find(release => gt(release.tag_name, installedVersion));
            if (!release) return false;

            // 2) Find the right asset from the release assets.
            // Our releases only contain a single VSIX. Thus we assume the first one is the correct one.
            const asset = release.assets.find(asset => asset.content_type === 'application/vsix');
            if (!asset) return false;

            // 3) Download the VSIX to temp.
            const url = new URL(asset.browser_download_url);
            const vsixFile = tmpNameSync({ postfix: '.vsix' });
            const stream = fs.createWriteStream(vsixFile);
            await new Promise((resolve, reject) => {
                const request = redirectableHttps.get({ // Only browser_download_url seems to have redirects. Otherwise would use fetch.
                    hostname: url.hostname,
                    path: url.pathname,
                    headers: { 'User-Agent': `microsoft.${extensionName}` },
                    agent,
                }, response => {
                    if (response.statusCode !== 200) reject();
                    response.pipe(stream);
                    response.on('end', resolve);
                });
                request.on('error', reject);
            });

            // 4) Install the VSIX, unless the user decides not to.
            // The user can change the "update channel" setting during the download. Thus, we need to re-confirm.
            if (!isUpdateEnabled()) return false;
            await commands.executeCommand('workbench.extensions.installExtension', Uri.file(vsixFile));
            const response = await window.showInformationMessage(
                `A new version of the SARIF Viewer (${release.tag_name}) has been installed. Reload to take affect.`,
                'Reload now'
            );
            if (response) {
                await commands.executeCommand('workbench.action.reloadWindow');
            }
            return true;
        } catch (error) {
            return false;
        }
    })();

    updateInProgress = false;
    return success;
}
