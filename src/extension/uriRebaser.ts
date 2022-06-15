// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { FileType, Uri, window, workspace } from 'vscode';
import '../shared/extension';
import platformUriNormalize from './platformUriNormalize';
import { Store } from './store';
import uriExists from './uriExists';

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

export class UriRebaser {
    constructor(
        private readonly distinctLocalNames: Map<string, string>,
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
    public translateLocalToArtifact(localUri: string): string { // Future: Ret undefined when certain.
        // Need to refresh on uri map update.
        if (!this.validatedUrisLocalToArtifact.has(localUri)) {
            const { file } = platformUriNormalize(localUri);

            // If no workspace then we choose to over-assume the localUri in-question is unique. It usually is,
            // but obviously can't always be true.
            // Over-assuming the localUri.name is distinct. There could be 2+ open docs with the same name.
            const noWorkspace = !workspace.workspaceFolders?.length;
            if ((noWorkspace || this.distinctLocalNames.has(file))
                && this.store.distinctArtifactNames.has(file)) {

                const artifactUri = this.store.distinctArtifactNames.get(file)!; // Not undefined due to surrounding if.
                this.updateValidatedUris(artifactUri, localUri);
                this.updateBases(splitUri(artifactUri), splitUri(localUri));
            }
        }
        return this.validatedUrisLocalToArtifact.get(localUri) ?? localUri;
    }

    private activeInfoMessages = new Set<string>() // Prevent repeat message animations when arrowing through many results with the same uri.
    public async translateArtifactToLocal(artifactUri: string) { // Retval is validated.
        if (Uri.parse(artifactUri, true).scheme === 'sarif') return artifactUri; // Sarif-scheme URIs are owned/created by us, so we know they exist.
        const recursiveMapping = async (maximumRecursionDepth:number, tempBase: string, artifactUri:string ): Promise<string[]> => {
            if (maximumRecursionDepth == 0) {
                return [];
            } else {
                let returnList = [] as string[];
                let tempLocalUri = tempBase + "/" +splitUri(artifactUri).slice(1).join('/');
                if (await uriExists(tempLocalUri)) {
                    returnList.push(tempLocalUri);
                    return returnList; // premature return to reduce time execution, comment this line to receive all qualified URIs 
                }
                for (const [name, type] of await workspace.fs.readDirectory(Uri.parse(tempBase))) {
                    if (type == FileType.Directory){
                        const subLstReturn = await recursiveMapping(maximumRecursionDepth-1, tempBase + "/" + name, artifactUri);
                        returnList = returnList.concat(subLstReturn);
                        if (returnList.length) return returnList; // premature return to reduce time execution, comment this line to receive all qualified URIs 
                    }
                }
                return returnList;
            }
        }
        const validateUri = async () => {
            // Cache
            if (this.validatedUrisArtifactToLocal.has(artifactUri))
                return this.validatedUrisArtifactToLocal.get(artifactUri)!;

            // File System Exist
            if (await uriExists(artifactUri))
                return artifactUri;

            // Known Bases
            for (const [artifactBase, localBase] of this.basesArtifactToLocal) {
                if (!artifactUri.startsWith(artifactBase)) continue; // Just let it fall through?
                const localUri = artifactUri.replace(artifactBase, localBase);
                if (await uriExists(localUri)) {
                    this.updateValidatedUris(artifactUri, localUri);
                    return localUri;
                }
            }

            { // API-injected baseUris
                const localUri = await this.tryUriBases(artifactUri);
                if (localUri) return localUri;
            }

            // Distinct Project Items
            const {file} = artifactUri;
            if (this.distinctLocalNames.has(file) && this.store.distinctArtifactNames.has(file)) {
                const localUri = this.distinctLocalNames.get(file)!; // Not undefined due to surrounding if.
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

            // Recursive map uri base
            if (workspace.workspaceFolders?.[0]?.uri) {
                const maximumRecursionDepthConfigSection = 'maximumRecursionDepth';
                const extensionName = 'sarif-viewer';
                const defaultMaximumRecursionDepth = 1;
                const maximumRecursionDepth = workspace.getConfiguration(extensionName).get<number>(maximumRecursionDepthConfigSection, defaultMaximumRecursionDepth);
                const lstLocalUri = await recursiveMapping(maximumRecursionDepth, workspace.workspaceFolders?.[0]?.uri.toString(), artifactUri);
                if (lstLocalUri.length) {
                    const localUri = lstLocalUri[0];
                    this.updateValidatedUris(artifactUri, localUri);
                    this.updateBases(splitUri(artifactUri), splitUri(localUri));
                    return localUri;
                }
            }

            return ''; // Signals inability to rebase.
        };

        let validatedUri = await validateUri();
        if (!validatedUri && !this.activeInfoMessages.has(artifactUri)) {
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
