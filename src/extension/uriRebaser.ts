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

const workspaceDistinctFilenameCache: Map<string, Uri | undefined> = new Map();

async function workspaceHasDistinctFilename(filename: string): Promise<Uri | undefined> {
    const distinctFileName = workspaceDistinctFilenameCache.get(filename);
    if (distinctFileName !== undefined) {
        return distinctFileName;
    }

    const matches = await workspace.findFiles(`**/${filename}`); // Is `.git` folder excluded?
    if (matches.length === 1) {
        workspaceDistinctFilenameCache.set(filename, matches[0]);
        return matches[0];
    }

    return undefined;
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
    private updateBases(artifact: string, local: Uri) {
        const localPath = local.toString();
        let commonLength = 0;
        while (
            commonLength < artifact.length &&
            commonLength < localPath.length &&
            artifact[artifact.length - commonLength - 1] === localPath[localPath.length - commonLength - 1]) {
            commonLength++;
        }
        this.basesArtifactToLocal.set(artifact.slice(0, -commonLength), localPath.slice(0, -commonLength));
    }

    private validatedUrisArtifactToLocal = new Map<string, Uri>()
    private validatedUrisLocalToArtifact = new Map<string, string>()
    private updateValidatedUris(artifact: string, local: Uri) {
        this.validatedUrisArtifactToLocal.set(artifact, local);

        // Maps use reference equality so we can't use Uri objects as keys.
        this.validatedUrisLocalToArtifact.set(local.toString(), artifact);
    }

    // Other possibilities:
    // * 1 local -> 2 artifacts (localUri still possible exact match of artUri)
    // * Actual 0 artifact match
    // Future:
    // 2:2 matching
    // Notes:
    // If 2 logs have the same uri, then likely the same (unless the uri is super short)
    // If 2 logs don't have the same uri, they can still potentially be the same match
    public async translateLocalToArtifact(localUri: Uri): Promise<string | undefined> {
        // Need to refresh on uri map update.
        if (!this.validatedUrisLocalToArtifact.has(localUri.toString())) {
            const { file } = platformUriNormalize(localUri).toString();

            // If no workspace then we choose to over-assume the localUri in-question is unique. It usually is,
            // but obviously can't always be true.
            // Over-assuming the localUri.name is distinct. There could be 2+ open docs with the same name.
            const noWorkspace = !workspace.workspaceFolders?.length;
            if ((noWorkspace || await workspaceHasDistinctFilename(file))
                && this.store.distinctArtifactNames.has(file)) {

                const artifactUri = this.store.distinctArtifactNames.get(file)!; // Not undefined due to surrounding if.
                this.updateValidatedUris(artifactUri, localUri);
                this.updateBases(artifactUri, localUri);
            }
        }
        return this.validatedUrisLocalToArtifact.get(localUri.toString());
    }

    private extensionName = 'sarif-viewer'
    private trustedSourceSitesConfigSection = 'trustedSourceSites';
    private trustedSites = workspace.getConfiguration(this.extensionName).get<string[]>(this.trustedSourceSitesConfigSection, []);
    private activeInfoMessages = new Set<string>() // Prevent repeat message animations when arrowing through many results with the same uri.
    public async translateArtifactToLocal(artifactUri: string, uriBase: string | undefined, versionControlProvenance?: VersionControlDetails[]): Promise<Uri | undefined> { // Retval is validated.
        // Sarif-scheme URIs are owned/created by us, so we know they exist.
        if (artifactUri.startsWith('sarif://')) return Uri.parse(artifactUri, true);

        const validateUri = async (): Promise<Uri | undefined> => {
            // Cache
            const artifact = this.validatedUrisArtifactToLocal.get(artifactUri);
            if (artifact)
                return artifact;

            const rxUriScheme = /^([^:/?#]+?):/;
            const isRelative = !rxUriScheme.test(artifactUri);
            if (isRelative) {
                // §3.4.4:
                // If the end user has configured the SARIF consumer with a value for the uriBaseId...
                // then the consumer SHALL use the configured value
                for (const uriBase of this.uriBases) {
                    const localUri = Uri.joinPath(Uri.parse(uriBase, true), artifactUri);
                    if (await uriExists(localUri)) {
                        this.updateValidatedUris(artifactUri, localUri);
                        return localUri;
                    }
                }

                // If uriBaseId is not yet resolved and theRun.originalUriBaseIds (§3.14.14) is present,
                // the consumer SHALL attempt to resolve the uriBaseId from the information in originalUriBaseIds
                if (uriBase) {
                    const localUri = Uri.joinPath(Uri.parse(uriBase, true), artifactUri);
                    if (await uriExists(localUri)) {
                        this.updateValidatedUris(artifactUri, localUri);
                        return localUri;
                    }
                }

                // If uriBaseId is not yet resolved,
                // the consumer MAY use other information or heuristics to locate the artifact.

                // File System Exist with Workspace prefixed
                const workspaceUri = workspace.workspaceFolders?.[0]?.uri; // TODO: Handle multiple workspaces.
                if (workspaceUri) {
                    const localUri = Uri.joinPath(workspaceUri, artifactUri);
                    if (await uriExists(localUri)) {
                        this.updateValidatedUris(artifactUri, localUri);
                        return localUri;
                    }
                }
            } else {
                // File System Exist
                const localUri = Uri.parse(artifactUri);
                if (await uriExists(localUri)) {
                    this.updateValidatedUris(artifactUri, localUri);
                    return localUri;
                }
            }

            // These strategies make sense regardless if the URI is relative or absolute

            // Known Bases
            for (const [artifactBase, localBase] of this.basesArtifactToLocal) {
                if (!artifactUri.startsWith(artifactBase)) continue; // Just let it fall through?
                const localUri = Uri.parse(artifactUri.replace(artifactBase, localBase), false);
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
                this.updateBases(artifactUri, localUri);
                return localUri;
            }

            // Open Docs
            for (const doc of workspace.textDocuments) {
                const localUri = doc.uri;
                if (localUri.toString().file !== artifactUri.file) continue;
                this.updateValidatedUris(artifactUri, localUri);
                this.updateBases(artifactUri, localUri);
                return localUri;
            }

            return undefined; // Signals inability to rebase.
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
                    return undefined;

                const fileUrl = Uri.file(fileName);
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
                                fs.mkdir(dir, { recursive: true }, (error) => {
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

                            this.updateBases(artifactUri, fileUrl);
                            return fileUrl;
                        }
                        catch (error) {
                            await window.showErrorMessage((error as Error).toString());
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
                if (!files?.length) return undefined; // User cancelled.

                this.updateBases(artifactUri, files[0]);

                const artifactFile = artifactUri.file;
                const localFile = files[0].toString().file;
                if (artifactFile !== localFile) {
                    void window.showErrorMessage(`File names must match: "${artifactFile}" and "${localFile}"`);
                    return undefined;
                }
            }
            validatedUri = await validateUri(); // Try again
        }
        return validatedUri;
    }

    public uriBases = [] as string[]
}
