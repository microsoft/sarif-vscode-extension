// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri, window, workspace, ConfigurationTarget } from 'vscode';
import '../shared/extension';
import platformUriNormalize from './platformUriNormalize';
import { Store } from './store';
import uriExists from './uriExists';
import { VersionControlDetails } from 'sarif';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import fetch from 'node-fetch';

/**
 * Splits a URI into path segments. Scheme+authority considered a "segment" for practical purposes.
 * Query and fragment are current ignored until we have a concrete use case.
 * @param uri - An absolute URI.
 */
function splitUri(uri: string | undefined) {
    if (uri === undefined) return [];
    const { scheme, authority, path } = Uri.parse(uri, true);
    return [`${scheme}://${authority}`, ...path.slice(1).split('/')]; // By spec first '/' always exists, thus safe to slice(1).
}

const workspaceDistinctFilenameCache: Map<string, string | undefined> = new Map();

async function workspaceHasDistinctFilename(filename: string): Promise<string | undefined> {
    if (workspaceDistinctFilenameCache.has(filename)) {
        return workspaceDistinctFilenameCache.get(filename);
    }
    const matches = await workspace.findFiles(`**/${filename}`); // Is `.git` folder excluded?
    const result = matches.length === 1 ? matches[0].toString() : undefined;

    workspaceDistinctFilenameCache.set(filename, result);
    return result;
}

workspace.onDidCreateFiles(async (event) => {
    for (const file of event.files) {
        const filename = path.basename(file.path);
        workspaceDistinctFilenameCache.delete(filename);
    }
});

workspace.onDidRenameFiles(async (event) => {
    for (const file of event.files) {
        const oldFilename = path.basename(file.oldUri.path);
        const newFilename = path.basename(file.newUri.path);
        if (oldFilename !== newFilename) {
            workspaceDistinctFilenameCache.delete(oldFilename);
        }
    }
});

workspace.onDidDeleteFiles(async (event) => {
    for (const file of event.files) {
        const filename = path.basename(file.path);
        workspaceDistinctFilenameCache.delete(filename);
    }
});

export class UriRebaser {
    constructor(
        private readonly store: Pick<Store, 'distinctArtifactNames'>) {
    }

    private basesArtifactToLocal = new Map<string, string>() // <artifactUri, localUri>
    private updateBases(artifact: string[], local: string[]) {
        const i = Array.commonLength(artifact.slice().reverse(), local.slice().reverse());
        this.basesArtifactToLocal.set(
            artifact.slice(0, -i).join('/'),
            local.slice(0, -i).join('/'));
    }

    private validatedUrisArtifactToLocal = new Map<string, string>()
    private validatedUrisLocalToArtifact = new Map<string, string>()
    private updateValidatedUris(artifact: string, local: string) {
        this.validatedUrisArtifactToLocal.set(artifact, local);
        this.validatedUrisLocalToArtifact.set(local, artifact);
    }

    // Other possibilities:
    // * 1 local -> 2 artifacts (localUri still possible exact match of artUri)
    // * Actual 0 artifact match
    // Future:
    // 2:2 matching
    // Notes:
    // If 2 logs have the same uri, then likely the same (unless the uri is super short)
    // If 2 logs don't have the same uri, they can still potentially be the same match
    public async translateLocalToArtifact(localUri: string): Promise<string> { // Future: Ret undefined when certain.
        // Need to refresh on uri map update.
        if (!this.validatedUrisLocalToArtifact.has(localUri)) {
            const { file } = platformUriNormalize(localUri);

            // If no workspace then we choose to over-assume the localUri in-question is unique. It usually is,
            // but obviously can't always be true.
            // Over-assuming the localUri.name is distinct. There could be 2+ open docs with the same name.
            const noWorkspace = !workspace.workspaceFolders?.length;
            if ((noWorkspace || await workspaceHasDistinctFilename(file))
                && this.store.distinctArtifactNames.has(file)) {

                const artifactUri = this.store.distinctArtifactNames.get(file)!; // Not undefined due to surrounding if.
                this.updateValidatedUris(artifactUri, localUri);
                this.updateBases(splitUri(artifactUri), splitUri(localUri));
            }
        }
        return this.validatedUrisLocalToArtifact.get(localUri) ?? localUri;
    }

    private extensionName = 'sarif-viewer'
    private trustedSourceSitesConfigSection = 'trustedSourceSites';
    private trustedSites = workspace.getConfiguration(this.extensionName).get<string[]>(this.trustedSourceSitesConfigSection, []);
    private activeInfoMessages = new Set<string>() // Prevent repeat message animations when arrowing through many results with the same uri.
    public async translateArtifactToLocal(artifactUri: string, uriBase: string | undefined, versionControlProvenance?: VersionControlDetails[]) { // Retval is validated.
        if (artifactUri.startsWith('sarif://')) return artifactUri; // Sarif-scheme URIs are owned/created by us, so we know they exist.

        const validateUri = async () => {
            // Cache
            const artifact = this.validatedUrisArtifactToLocal.get(artifactUri);
            if (artifact)
                return artifact;

            const rxUriScheme = /^([^:/?#]+?):/;
            const isRelative = !rxUriScheme.test(artifactUri);
            if (isRelative) {
                // API-injected uriBases
                for (const uriBase of this.uriBases) {
                    let localUri: string;
                    try {
                        localUri = Uri.joinPath(Uri.parse(uriBase, true), artifactUri).toString();
                    } catch {
                        // No URI scheme; assume the base is a file.
                        localUri = Uri.file(path.join(uriBase, artifactUri)).toString();
                    }

                    if (await uriExists(localUri)) {
                        this.updateValidatedUris(artifactUri, localUri);
                        return localUri;
                    }
                }

                // File System Exist with Workspace prefixed
                const workspaceUri = workspace.workspaceFolders?.[0]?.uri; // TODO: Handle multiple workspaces.
                if (workspaceUri) {
                    const localUri = Uri.joinPath(workspaceUri, artifactUri).toString();
                    if (await uriExists(localUri)) {
                        this.updateValidatedUris(artifactUri, localUri);
                        return localUri;
                    }
                }

                artifactUri = Uri.file(artifactUri).toString();

                // Known Bases
                for (const [artifactBase, localBase] of this.basesArtifactToLocal) {
                    if (!artifactUri.startsWith(artifactBase)) continue; // Just let it fall through?
                    const localUri = artifactUri.replace(artifactBase, localBase);
                    if (await uriExists(localUri)) {
                        this.updateValidatedUris(artifactUri, localUri);
                        return localUri;
                    }
                }

                // Distinct Project Items
                const {file} = artifactUri;
                const distinctFilename = await workspaceHasDistinctFilename(file);
                if (distinctFilename && this.store.distinctArtifactNames.has(file)) {
                    const localUri = distinctFilename;
                    this.updateValidatedUris(artifactUri, localUri);
                    this.updateBases(splitUri(artifactUri), splitUri(localUri));
                    return localUri;
                }

                // Open Docs
                for (const doc of workspace.textDocuments) {
                    const localUri = doc.uri.toString();
                    if (localUri.file !== artifactUri.file) continue;
                    this.updateValidatedUris(artifactUri, localUri);
                    this.updateBases(splitUri(artifactUri), splitUri(localUri));
                    return localUri;
                }

                // SARIF-provided uriBase
                if (uriBase) {
                    let localUri: string;
                    try {
                        localUri = Uri.joinPath(Uri.parse(uriBase, true), artifactUri).toString();
                    } catch {
                        // No URI scheme; assume the base is a file.
                        localUri = Uri.file(path.join(uriBase, artifactUri)).toString();
                    }

                    if (await uriExists(localUri)) {
                        this.updateValidatedUris(artifactUri, localUri);
                        return localUri;
                    }
                }
            } else {
                // File System Exist
                if (await uriExists(artifactUri))
                    return artifactUri;
            }

            return ''; // Signals inability to rebase.
        };

        let validatedUri = await validateUri();
        if (!validatedUri && !this.activeInfoMessages.has(artifactUri)) {
            // download from internet by changeset
            if (versionControlProvenance !== undefined) {
                const url = new URL(`${versionControlProvenance[0].repositoryUri}/${versionControlProvenance[0].revisionId}/${artifactUri.startsWith('file://') ? artifactUri.substring(7) : artifactUri}`);
                if (url.hostname === 'github.com') {
                    url.hostname = 'raw.githubusercontent.com';
                }

                // check for path traversal
                const root = os.tmpdir().endsWith(path.sep) ? os.tmpdir() : `${os.tmpdir()}${path.sep}`;
                const fileName = path.join(root, url.pathname).normalize();
                if (!fileName.startsWith(root))
                    return '';

                const fileUrl = `file:///${fileName.replace(/\\/g, '/')}`;
                // check if the file was already downloaded
                if (await uriExists(fileUrl))
                    return fileUrl;

                if (url.protocol === 'https:') {
                    let choice: string | undefined = 'Yes';
                    const alwaysMsg = `Always from ${url.hostname}`;
                    // check if user marked this site as trusted to download always
                    if (!this.trustedSites.includes(url.hostname)) {
                        this.activeInfoMessages.add(artifactUri);
                        choice = await window.showInformationMessage(
                            `Do you want to download the source file from this location?\n${url}`,
                            'Yes',
                            'No',
                            alwaysMsg
                        );
                        this.activeInfoMessages.delete(artifactUri);
                    }
                    // save the user preference to settings
                    if (choice === alwaysMsg) {
                        this.trustedSites.push(url.hostname);
                        workspace.getConfiguration(this.extensionName)
                            .update(this.trustedSourceSitesConfigSection, this.trustedSites, ConfigurationTarget.Global);
                    }
                    // download the file
                    if (choice === 'Yes' || choice === alwaysMsg) {
                        const mkdirRecursive = async (dir: string) => {
                            return new Promise((resolve, reject) => {
                                fs.mkdir(dir, { recursive: true }, (error: any) => {
                                    if (error) {
                                        reject(error);
                                    } else {
                                        resolve(undefined);
                                    }
                                });
                            });
                        };

                        try {
                            const response = await fetch(url);
                            const buffer = await response.buffer();
                            const dir = path.dirname(fileName);
                            await mkdirRecursive(dir);
                            await fs.promises.writeFile(fileName, buffer);

                            const partsOld = splitUri(artifactUri);
                            const partsNew = splitUri(`file://${fileName.replace(/\\/g, '/')}`);
                            this.updateBases(partsOld, partsNew);
                            return fileUrl;
                        }
                        catch (error: any) {
                            await window.showErrorMessage(error.toString());
                            // continue with file open dialog
                        }
                    }
                }
            }

            this.activeInfoMessages.add(artifactUri);
            const choice = await window.showInformationMessage(`Unable to find '${artifactUri.file}'`, 'Locate...');
            this.activeInfoMessages.delete(artifactUri);
            if (choice) {
                const extension = artifactUri.match(/\.([\w]+)$/)?.[1] ?? '';
                const files = await window.showOpenDialog({
                    defaultUri: workspace.workspaceFolders?.[0]?.uri,
                    filters: { 'Matching file' : [extension] },
                    // Consider allowing folders.
                });
                if (!files?.length) return ''; // User cancelled.

                const partsOld = splitUri(artifactUri);
                const partsNew = splitUri(files[0].toString());
                if (partsOld.last !== partsNew.last) {
                    void window.showErrorMessage(`File names must match: "${partsOld.last}" and "${partsNew.last}"`);
                    return '';
                }
                this.updateBases(partsOld, partsNew);
            }
            validatedUri = await validateUri(); // Try again
        }
        return validatedUri;
    }

    public static *commonIndices<T>(a: T[], b: T[]) { // Add comparator?
        for (const [aIndex, aPart] of a.entries()) {
            for (const [bIndex, bPart] of b.entries()) {
                if (aPart === bPart) yield [aIndex, bIndex];
            }
        }
    }

    public uriBases = [] as string[]
    private async tryUriBases(artifactUri: string) {
        const artifactParts = splitUri(artifactUri);
        for (const localUriBase of this.uriBases) {
            const localParts = splitUri(localUriBase);
            for (const [artifactIndex, localIndex] of UriRebaser.commonIndices(artifactParts, localParts)) {
                const rebased = [...localParts.slice(0, localIndex), ...artifactParts.slice(artifactIndex)].join('/');
                if (await uriExists(rebased)) {
                    this.updateValidatedUris(artifactUri, localUriBase);
                    this.updateBases(artifactParts, localParts);
                    return rebased;
                }
            }
        }
        return undefined;
    }
}
