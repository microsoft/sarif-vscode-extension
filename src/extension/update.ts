// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { https as redirectableHttps } from 'follow-redirects';
import fs from 'fs';
import fetch from 'node-fetch';
import { gt, prerelease } from 'semver';
import { tmpNameSync } from 'tmp';
import { commands, extensions, Uri, window, workspace } from 'vscode';

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
    const vsixAssetName = `${extensionFullName}.vsix`;
    const installedVersion = extensions.getExtension(extensionFullName)!.packageJSON.version;

    // 1) Find the right release from the list.
    const releasesResponse = await fetch('https://api.github.com/repos/Microsoft/sarif-vscode-extension/releases');
    const releases = await releasesResponse.json() as { tag_name: string, assets_url: string }[];
    const release = releases.find(release =>
        prerelease(release.tag_name)?.some(tag => tag === 'insiders')
        && gt(release.tag_name, installedVersion)
    );
    if (!release) return false;

    // 2) Find the right asset from the release assets.
    const assetsResponse = await fetch(release.assets_url);
    const assets = await assetsResponse.json() as { browser_download_url: string, content_type: string, name: string }[];
    const asset = assets.find(asset => asset.content_type === 'application/octet-stream'
        && asset.name === vsixAssetName);
    if (!asset) return false;

    // 3) Download the VSIX to temp.
    const url = new URL(asset.browser_download_url);
    const vsixFile = tmpNameSync({ postfix: '.vsix' });
    const stream = fs.createWriteStream(vsixFile);
    await new Promise(resolve => {
        redirectableHttps.get({ // Only browser_download_url seems to have redirects. Otherwise would use fetch.
            hostname: url.hostname,
            path: url.pathname,
            headers: { 'User-Agent': `microsoft.${extensionName}` }
        }, response => {
            response.pipe(stream);
            response.on('end', resolve);
        });
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

    updateInProgress = false;
    return true;
}
