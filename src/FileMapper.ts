/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as fs from "fs";
import * as path from "path";
import * as sarif from "sarif";
import {
    ConfigurationChangeEvent, Disposable, Event, EventEmitter, QuickInputButton, Uri,
    window, workspace, WorkspaceConfiguration, InputBox, commands
} from "vscode";
import { ProgressHelper } from "./ProgressHelper";
import { Utilities } from "./Utilities";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";

const RootPathSample: string = "c:\\sample\\path";
const ConfigRootPaths: string = "rootpaths";

/**
 * Handles mapping file locations if the file is not in the location specified in the sarif file
 * Maintains a mapping of the files that have been remapped
 * Maintains a mapping of the base of the remapped files to try to apply to files that can't be found
 */
export class FileMapper implements Disposable {
    private disposables: Disposable[] = [];

    public static readonly MapCommand = "extension.sarif.Map";

    /**
     * Contains a mapping of root paths (base paths) in the SARIF
     * to local paths.
     */
    private readonly baseRemapping: Map<string, string> = new Map<string, string>();

    /**
     * Contains a mapping of absolute paths (including fragments from the original Location)
     * to a local mapping. If the value (Uri) is undefined, it indicates either the user
     * cancelled the mapping.
     */
    private readonly fileRemapping: Map<string, Uri | undefined> = new Map<string, Uri | undefined>();

    /**
     * Maintains a mapping of sarif artifacts to a "key" into fileMapping.
     * The key of this map is in the form of "RunID_ArtifactIndex".
     * As an example, each SARIF file can have multiple "runs" inside, and each one
     * with its own list of artifacts.
     * "runs:" [
     *    {
     *       artifacts:
     *       [
     *          {}, {}
     *       ]
     *    },
     *    {
     *       artifacts:
     *       [
     *          {}, {}
     *       ]
     *    }
     * ]
     *
     * So the "key" is the run identifier concatenated with the index of the artifact.
     * For example, 1_0 would indicate the first artifact of the second run.
     * IMPORTANT NOTE: The run identifier is not simply an index into the SARIF file.
     * The run identifier is dynamically calculated as a run's information is added to VSCode's
     * diagnostic collection. As SARIF files are opened and closed, the identifier grows.
     */
    private readonly fileIndexKeyMapping: Map<string, string> = new Map<string, string>();

    private readonly mappingChangedEventEmitter: EventEmitter<Uri> = new EventEmitter<Uri>();

    /**
     * Indicates that the user previously cancelled mapping a SARIF root path to a local root path.
     * This flag is set to "true" when the user cancels the remapping flow, and cleared
     * when "mapArtifacts" is called, which happens once per "run" in a SARIF file.
     */
    private userCanceledMappingForRun: boolean = false;

    /**
     * Contains the root paths configured in the settings by the user or
     * paths automatically added when the user uses the remap UI flow.
     */
    private rootpaths: string[] = [];

    public constructor(private readonly diagnosticCollection: SVDiagnosticCollection) {
        this.updateRootPaths();
        this.disposables.push(this.mappingChangedEventEmitter);
        this.disposables.push(workspace.onDidChangeConfiguration(this.updateRootPaths, this));
        this.disposables.push(commands.registerCommand(FileMapper.MapCommand, this.mapFileCommand.bind(this)));
    }

    public get onMappingChanged(): Event<Uri> {
        return this.mappingChangedEventEmitter.event;
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
    }

    /**
     * Gets the mapped Uri associated with the passed in file, promise returns null if not able to map
     * @param fileUri Uri of the file
     * @param fileIndex file index of artifact
     * @param runId id of the run
     * @param uriBase the base path of the uri
     */
    public async get(location: sarif.ArtifactLocation, runId: number, uriBase?: string):
        Promise<{mapped: boolean; uri?: Uri}> {
        let uriPathKey: string | undefined;
        let mappedUri: Uri | undefined;

        if (location.index !== undefined) {
            // If the SARIF artifact location has an index, then it is a "reference"
            // to the artifacts contained in that run. So get the key into the
            // fileRemapping map.
            uriPathKey = this.fileIndexKeyMapping.get(`${runId}_${location.index}`);
        } else if (location.uri) {
            // If the SARIF artifact location has a UIR, then we create the key
            // for the fileRemapping and see if we already have a mapping.
            // If we don't, then attempt to map the location (which may ask the user).
            const uri: Uri = Utilities.combineUriWithUriBase(location.uri, uriBase);
            uriPathKey = Utilities.getFsPathWithFragment(uri);
            mappedUri = this.fileRemapping.get(uriPathKey);
            if (!mappedUri) {
                await this.map(uri, uriBase);
            }
        }

        // If we weren't able to create the file mapping key, then we are certainly done.
        if (!uriPathKey) {
            return {
                mapped: false
            };
        }

        // We could have found the mapped URI above (so don't look up again if that's the case),
        // but if the this was an index "reference" or we asked the user to map,
        // then we need attempt to retrieve the file mapping again.
        if (!mappedUri) {
            mappedUri = this.fileRemapping.get(uriPathKey);
        }

        return {
            mapped: mappedUri !== undefined,
            uri: mappedUri || Uri.parse(uriPathKey)
        };
    }

    /**
     * Opens a dialog for the user to select the file location to map the file to
     * Saves the mapping, base mapping
     * @param origUri Uri the user needs to remap, if it has a uriBase it should be included in this uri
     * @param uriBase the base path of the uri
     */
    public async getUserToChooseFile(origUri: Uri, uriBase?: string): Promise<void> {
        const oldProgressMsg: string | undefined = ProgressHelper.Instance.CurrentMessage;
        await ProgressHelper.Instance.setProgressReport("Waiting for user input");

        const remapResult: string | undefined = await this.openRemappingInputDialog(origUri);

        this.userCanceledMappingForRun = remapResult === undefined;

        // If the user cancelled the mapping, then set undefined into the file mapping
        // map to indicate that.
        if (!remapResult) {
            this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), undefined);
            return;
        }

        const uri: Uri = Uri.file(remapResult);
        const filePath: string = Utilities.getFsPathWithFragment(uri);

        if (fs.statSync(filePath).isDirectory()) {
            const config: WorkspaceConfiguration = workspace.getConfiguration(Utilities.configSection);
            const rootpaths: string[] = config.get(ConfigRootPaths, []);

            if (rootpaths.length === 1 && rootpaths[0] === RootPathSample) {
                rootpaths.pop();
            }

            rootpaths.push(Utilities.getDisplayableRootpath(uri));
            this.rootpaths = rootpaths;
            await config.update(ConfigRootPaths, rootpaths, true);

            if (!this.tryConfigRootpathsUri(origUri, uriBase)) {
                this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), undefined);
            }
        } else {
            this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), uri);
            this.saveBasePath(origUri, uri, uriBase);
            this.fileRemapping.forEach((value: Uri | undefined, key: string) => {
                if (value === null) {
                    this.tryRebaseUri(Uri.file(key));
                }
            });
        }

        this.mappingChangedEventEmitter.fire(origUri);

        await ProgressHelper.Instance.setProgressReport(oldProgressMsg);
    }

    /**
     * Tries to map the passed in uri to a file location
     * @param uri Uri that needs to be mapped, should already have uribase included
     * @param uriBase the base path of the uri
     */
    public async map(uri: Uri, uriBase?: string): Promise<void> {
        // check if the file has already been remapped and the mapping isn't null(previously failed to map)
        const uriPath: string = Utilities.getFsPathWithFragment(uri);

        // If the mapping already done, then we're done.
        const existingFileMapping: Uri | undefined = this.fileRemapping.get(uriPath);
        if (existingFileMapping) {
            return;
        }

        if (this.tryMapUri(uri, uriPath)) {
            return;
        }

        if (this.tryRebaseUri(uri)) {
            return;
        }

        if (this.tryConfigRootpathsUri(uri, uriBase)) {
            return;
        }

        // if user previously canceled mapping we don't open the file chooser
        if (this.userCanceledMappingForRun) {
            this.addToFileMapping(uriPath, undefined);
            return;
        }

        // If not able to remap using other means, we need to ask the user to enter a path for remapping
        await this.getUserToChooseFile(uri, uriBase);
    }

    /**
     * Call to map the files in the Sarif run artifact objects
     * @param artifacts array of sarif.Artifact that needs to be mapped
     * @param runId id of the run these files are from
     */
    public async mapArtifacts(artifacts: sarif.Artifact[], runId: number): Promise<void> {

        // This function is called once per SARIF run while parsing is occurring for the
        // array of artifacts in that run.
        // We want to give the user a chance to perform mapping for each run, so clear
        // the user canceled mapping flag.
        this.userCanceledMappingForRun = false;

        for (const [artifactIndex, artifact] of artifacts.entries()) {
            const fileLocation: sarif.ArtifactLocation | undefined = artifact.location;

            if (!artifact.location || !artifact.location.uri) {
                continue;
            }

            const uriBase: string | undefined = Utilities.getUriBase(this.diagnosticCollection, fileLocation, runId);
            const uriWithBase: Uri = Utilities.combineUriWithUriBase(artifact.location.uri, uriBase);

            const key: string = Utilities.getFsPathWithFragment(uriWithBase);

            if (artifact.contents) {
                // If the artifact has embedded contents, then a temporary file is created and that will be
                // used for the file mapping.
                this.mapEmbeddedContent(key, artifact);
            } else {
                await this.map(uriWithBase, uriBase);
            }

            this.fileIndexKeyMapping.set(`${runId}_${artifactIndex}`, key);
        }
    }

    /**
     * Adds a file/Uri mapping to the fileRemapping, also calls toString to generate the .external for the webview
     * @param key the original file path
     * @param uri the uri of the mapped file path
     */
    private addToFileMapping(key: string, uri?: Uri): void {
        if (uri) {
            uri.toString();
        }

        this.fileRemapping.set(key, uri);
    }

    /**
     * Gets the hash value for the embedded content. Preference for sha256, if not found it uses the first hash value
     * @param hashes dictionary of hashes
     */
    private getHashValue(hashes?: { [key: string]: string }): string {
        let value: string = "";
        if (hashes) {
            const sha256Key: string  = "sha256";
            if (hashes[sha256Key]) {
                value = hashes[sha256Key];
            } else {
                for (const key in hashes) {
                    if (hashes.hasOwnProperty(key)) {
                        value = hashes[key];
                        break;
                    }
                }
            }
        }

        return value;
    }

    /**
     * Creates a temp file with the decoded content and adds the new temp file to the mapping
     * @param fileKey key of the original file path that needs to be mapped
     * @param artifact file object that contains the hash and embedded content
     */
    private mapEmbeddedContent(fileKey: string, artifact: sarif.Artifact): void {
        const hashValue: string = this.getHashValue(artifact.hashes);
        let tempPath: string = Utilities.generateTempPath(fileKey, hashValue);

        if (!artifact.contents) {
            return;
        }

        let contents: string | undefined;
        if (artifact.contents.text) {
            contents = artifact.contents.text;
        } else if (artifact.contents.binary) {
            contents = Buffer.from(artifact.contents.binary, "base64").toString();
        } else if (artifact.contents.rendered) {
            if (artifact.contents.rendered.markdown) {
                tempPath = tempPath + ".md";
                contents = artifact.contents.rendered.markdown;
            } else {
                contents = artifact.contents.rendered.text;
            }
        }

        if (contents) {
            Utilities.createReadOnlyFile(tempPath, contents);
        }

        // Even if we did not write any contents, this file must still exist as we
        // created a temporary file for it and expect it to be mapped.
        this.addToFileMapping(fileKey, Uri.file(tempPath));
    }

    /**
     * Shows the Inputbox with message for getting the user to select the mapping
     * @param uri uri of the file that needs to be mapped
     */
    private async openRemappingInputDialog(uri: Uri): Promise<string | undefined> {
        interface RemappingQuickInputButtons extends QuickInputButton {
            remappingType: 'Open' | 'Skip';
        }

        return new Promise<string>((resolve, rejected) => {
            const disposables: Disposable[] = [];
            let resolvedString: string | undefined;

            const input: InputBox = window.createInputBox();
            input.title = "Sarif Result Location Remapping";
            input.value = uri.fsPath;
            input.prompt = `Valid path, confirm if it maps to '${uri.fsPath}' or its rootpath`;
            input.validationMessage = `'${uri.fsPath}' can not be found.\r\nCorrect the path to: the local file (c:/example/repo1/source.js) for this session or the local rootpath (c:/example/repo1/) to add it to the user settings (Press 'Escape' to cancel)`;
            input.ignoreFocusOut = true;

            input.buttons = <RemappingQuickInputButtons[]>[{
                iconPath: Utilities.IconsPath + "open-folder.svg",
                tooltip: "Open file picker",
                remappingType: 'Open'
            }, {
                iconPath: Utilities.IconsPath + "next.svg",
                tooltip: "Skip to next",
                remappingType: 'Skip'
            }];

            disposables.push(input.onDidAccept(() => {
                if (resolvedString) {
                    input.hide();
                    resolve(resolvedString);
                }
            }));

            disposables.push(input.onDidHide(() => {
                resolve(resolvedString);
            }));

            disposables.push(input.onDidTriggerButton(async (button) => {
                switch ((<RemappingQuickInputButtons>button).remappingType) {
                    case 'Open':
                        const selectedUris: Uri[] | undefined = await window.showOpenDialog({
                            canSelectMany: false,
                            openLabel: "Map"
                        });

                        if (selectedUris && selectedUris.length === 1) {
                            input.value = selectedUris[0].fsPath;
                        }
                        break;

                    case 'Skip':
                        input.hide();
                        resolve(resolvedString);
                        break;
                }
            }));

            disposables.push(input.onDidChangeValue(() => {
                const directory: string = input.value;
                let message: string | undefined = `'${uri.fsPath}' can not be found.
                Correct the path to: the local file (c:/example/repo1/source.js) for this session or the local
                rootpath (c:/example/repo1/) to add it to the user settings (Press 'Escape' to cancel)`;

                if (directory && directory.length !== 0) {
                    let validateUri: Uri | undefined;
                    let isDirectory: boolean = false;

                    try {
                        validateUri = Uri.file(directory);
                    } catch (error) {
                        if (error.message !== "URI malformed") {
                            throw error;
                        }
                    }

                    if (validateUri) {
                        try {
                            isDirectory = fs.statSync(validateUri.fsPath).isDirectory();
                        } catch (error) {
                            switch (error.code) {
                                // Path not found.
                                case "ENOENT":
                                    break;

                                case "UNKNOWN":
                                    if (validateUri.authority !== "") {
                                        break;
                                    }
                                    throw error;

                                default:
                                    throw error;
                            }
                        }

                        if (isDirectory) {
                            const rootPathIndex: number = this.rootpaths.indexOf(validateUri.fsPath);
                            if (rootPathIndex !== -1) {
                                message = `'${validateUri.fsPath}' already exists in the settings
                                    (sarif-viewer.rootpaths), please try a different path (Press 'Escape' to cancel)`;
                            } else {
                                resolvedString = this.rootpaths[rootPathIndex];
                            }
                        } else if (this.tryMapUri(validateUri)) {
                            message = undefined;
                        }
                    }
                }

                input.validationMessage = message;
            }));

            input.show();
        });
    }

    /**
     * Determines the base path of the remapped Uri. Does so by
     * starting at the end of both pathes character compares
     * when it finds a mismatch it uses the index as the end of the substring of the bases for each path
     * @param originalUri Uri found in the sarif file
     * @param remappedUri Uri the originalUri has been successfully mapped to
     * @param uriBase Base path of the uri if defined in the sarif file
     */
    private saveBasePath(originalUri: Uri, remappedUri: Uri, uriBase?: string): void {
        const oPath: string = originalUri.toString(true);
        const rPath: string = remappedUri.toString(true);
        if (uriBase !== undefined) {
            const relativePath: string = oPath.substring(oPath.indexOf(uriBase) + uriBase.length);
            const index: number = rPath.indexOf(relativePath);
            if (index !== -1) {
                this.baseRemapping.set(oPath.replace(relativePath, ""), rPath.replace(relativePath, ""));
                return;
            }
        }

        for (let i: number = 1; i <= rPath.length; i++) {
            const oIndex: number = oPath.length - i;
            const rIndex: number = rPath.length - i;
            if (oIndex === 0 || oPath[oIndex].toLocaleLowerCase() !== rPath[rIndex].toLocaleLowerCase()) {
                this.baseRemapping.set(oPath.substring(0, oIndex + 1), rPath.substring(0, rIndex + 1));
                break;
            }
        }
    }

    /**
     * Check if the file exists at the provided path, if so and a Key was provided it will be added to the mapped files
     * returns false if uri is a directory or if the file can't be found
     * @param uri file uri to check if exists
     * @param key key used for mapping, if undefined the mapping won't be added if it exists
     */
    private tryMapUri(uri: Uri, key?: string): boolean {
        try {
            if (!fs.statSync(Utilities.getFsPathWithFragment(uri)).isDirectory()) {
                if (key !== undefined) {
                    this.addToFileMapping(key, uri);
                }
                return true;
            }
        } catch (error) {
            switch (error.code) {
                case "ENOENT":
                    break;

                case "UNKNOWN":
                    if (uri.authority !== "") {
                        break;
                    }
                    break;

                default:
                    throw error;
            }
        }

        return false;
    }

    /**
     * Check if base can be remapped using any of the existing base mappings
     * @param uri file uri to try to rebase
     */
    private tryRebaseUri(uri: Uri): boolean {
        for (const [base, remappedBase] of this.baseRemapping.entries()) {
            const uriText: string = uri.toString(true);
            if (uriText.indexOf(base) === 0) {
                const newpath: string = uriText.replace(base, remappedBase);
                const mappedUri: Uri = Uri.parse(newpath);
                if (this.tryMapUri(mappedUri, Utilities.getFsPathWithFragment(uri))) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Tries to remapped path using any of the RootPaths in the config
     * @param uri file uri to try to rebase
     */
    private tryConfigRootpathsUri(uri: Uri, uriBase?: string): boolean {
        const originPath: path.ParsedPath = path.parse(Utilities.getFsPathWithFragment(uri));
        const dir: string = originPath.dir.replace(originPath.root, "");

        for (const rootpath of this.rootpaths) {
            const dirParts: string[] = dir.split(path.sep);
            dirParts.push(originPath.base);

            while (dirParts.length !== 0) {
                const mappedUri: Uri = Uri.file(Utilities.joinPath(rootpath, dirParts.join(path.sep)));
                if (this.tryMapUri(mappedUri, Utilities.getFsPathWithFragment(uri))) {
                    this.saveBasePath(uri, mappedUri, uriBase);
                    return true;
                }

                dirParts.shift();
            }
        }

        return false;
    }

    /**
     * Updates the rootpaths property with the latest from the configuration
     * @param event Optional event if this was called because the configuration change
     */
    private updateRootPaths(event?: ConfigurationChangeEvent): void {
        if (!event || event.affectsConfiguration(Utilities.configSection)) {
            const sarifConfig: WorkspaceConfiguration = workspace.getConfiguration(Utilities.configSection);
            const newRootPaths: string [] = sarifConfig.get(ConfigRootPaths, []).filter((value, index, array) => {
                return value !== RootPathSample;
            });

            if (this.rootpaths.sort().toString() !== newRootPaths.sort().toString()) {
                this.rootpaths = newRootPaths;
                this.updateMappingsWithRootPaths();
            }
        }
    }

    /**
     * Goes through the filemappings and tries to remap any that aren't mapped(null) using the rootpaths
     */
    private updateMappingsWithRootPaths(): void {
        let remapped: boolean = false;
        this.fileRemapping.forEach((value: Uri | undefined, key: string, map: Map<string, Uri | undefined>) => {
            remapped = remapped || this.tryConfigRootpathsUri(Uri.file(key), undefined);
        });

        if (remapped) {
            this.mappingChangedEventEmitter.fire();
        }
    }

    private async mapFileCommand(fileLocation: sarif.ArtifactLocation, runId: number): Promise<void>  {
        const uriBase: string | undefined = Utilities.getUriBase(this.diagnosticCollection, fileLocation, runId);
        if (!uriBase || !fileLocation.uri) {
            return;
        }

        const uri: Uri  = Utilities.combineUriWithUriBase(fileLocation.uri, uriBase);
        await this.getUserToChooseFile(uri, uriBase);
    }
}
