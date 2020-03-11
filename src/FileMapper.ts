/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as fs from "fs";
import * as path from "path";
import * as sarif from "sarif";
import {
    ConfigurationChangeEvent, Disposable, Event, EventEmitter, QuickInputButton, Uri,
    window, workspace, WorkspaceConfiguration, InputBox,
} from "vscode";
import { ProgressHelper } from "./ProgressHelper";
import { Utilities } from "./Utilities";

/**
 * Handles mapping file locations if the file is not in the location specified in the sarif file
 * Maintains a mapping of the files that have been remapped
 * Maintains a mapping of the base of the remapped files to try to apply to files that can't be found
 */
export class FileMapper {
    public static readonly MapCommand = "extension.sarif.Map";

    private static instance: FileMapper;

    private baseRemapping: Map<string, string>;
    private fileRemapping: Map<string, Uri>;
    private fileIndexKeyMapping: Map<string, string>;
    private onMappingChanged: EventEmitter<Uri>;
    private userCanceledMapping: boolean = false;
    private rootpaths: string[] = [];
    private readonly rootpathSample = "c:\\sample\\path";
    private readonly configRootpaths = "rootpaths";
    private changeConfigDisposable: Disposable;

    private constructor() {
        this.baseRemapping = new Map<string, string>();
        this.fileRemapping = new Map<string, Uri>();
        this.fileIndexKeyMapping = new Map<string, string>();
        this.onMappingChanged = new EventEmitter<Uri>();

        this.updateRootPaths();
        this.changeConfigDisposable = workspace.onDidChangeConfiguration(this.updateRootPaths, this);
    }

    public static get Instance(): FileMapper {
        return FileMapper.instance || (FileMapper.instance = new FileMapper());
    }

    public get OnMappingChanged(): Event<Uri> {
        return this.onMappingChanged.event;
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        this.changeConfigDisposable.dispose();
    }

    /**
     * Gets the mapped Uri associated with the passed in file, promise returns null if not able to map
     * @param fileUri Uri of the file
     * @param fileIndex file index of artifact
     * @param runId id of the run
     * @param uriBase the base path of the uri
     */
    public async get(location: sarif.ArtifactLocation, runId: number, uriBase?: string):
        Promise<Uri | undefined> {
        let uriPath: string | undefined;
        if (location.index) {
            uriPath = this.fileIndexKeyMapping.get(`${runId}_${location.index}`);
        } else {
            if (location.uri) {
                const uri: Uri = Utilities.combineUriWithUriBase(location.uri, uriBase);
                uriPath = Utilities.getFsPathWithFragment(uri);
                if (!this.fileRemapping.has(uriPath)) {
                    await this.map(uri, uriBase);
                }
            }
        }

        if (!uriPath) {
            return undefined;
        }

        return this.fileRemapping.get(uriPath);
    }

    /**
     * Opens a dialog for the user to select the file location to map the file to
     * Saves the mapping, base mapping
     * @param origUri Uri the user needs to remap, if it has a uriBase it should be included in this uri
     * @param uriBase the base path of the uri
     */
    public async getUserToChooseFile(origUri: Uri, uriBase: string): Promise<void> {
        const oldProgressMsg: string = ProgressHelper.Instance.CurrentMessage;
        await ProgressHelper.Instance.setProgressReport("Waiting for user input");

        const directory: string | undefined = await this.openRemappingInputDialog(origUri);

        if (!directory) {
            // path is undefined if the skip next button was pressed or the input was dismissed without fixing the path
            this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), undefined);
        } else {
            const uri: Uri = Uri.file(directory);
            const filePath: string = Utilities.getFsPathWithFragment(uri);

            if (fs.statSync(filePath).isDirectory()) {
                const config: WorkspaceConfiguration = workspace.getConfiguration(Utilities.configSection);
                const rootpaths: string[] = config.get(this.configRootpaths, []);

                if (rootpaths.length === 1 && rootpaths[0] === this.rootpathSample) {
                    rootpaths.pop();
                }

                rootpaths.push(Utilities.getDisplayableRootpath(uri));
                this.rootpaths = rootpaths;
                await config.update(this.configRootpaths, rootpaths, true);

                if (!this.tryConfigRootpathsUri(origUri, uriBase)) {
                    this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), undefined);
                }
            } else {
                this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), uri);
                this.saveBasePath(origUri, uri, uriBase);
                this.fileRemapping.forEach((value: Uri, key: string) => {
                    if (value === null) {
                        this.tryRebaseUri(Uri.file(key));
                    }
                });
            }

            this.onMappingChanged.fire(origUri);

            await ProgressHelper.Instance.setProgressReport(oldProgressMsg);
            return Promise.resolve();
        }
    }

    /**
     * Tries to map the passed in uri to a file location
     * @param uri Uri that needs to be mapped, should already have uribase included
     * @param uriBase the base path of the uri
     */
    public async map(uri: Uri, uriBase?: string): Promise<void> {
        // check if the file has already been remapped and the mapping isn't null(previously failed to map)
        const uriPath: string = Utilities.getFsPathWithFragment(uri);
        if (this.fileRemapping.has(uriPath) && this.fileRemapping.get(uriPath) !== null) {
            return Promise.resolve();
        }

        if (this.tryMapUri(uri, uriPath)) {
            return Promise.resolve();
        }

        if (this.tryRebaseUri(uri)) {
            return Promise.resolve();
        }

        if (uriBase && this.tryConfigRootpathsUri(uri, uriBase)) {
            return Promise.resolve();
        }

        // if user previously canceled mapping we don't open the file chooser
        if (this.userCanceledMapping) {
            this.addToFileMapping(uriPath, undefined);
            return Promise.resolve();
        }

        // If not able to remap using other means, we need to ask the user to enter a path for remapping
        if (uriBase) {
            await this.getUserToChooseFile(uri, uriBase);
        }
    }

    /**
     * Call to map the files in the Sarif run files object
     * @param files array of sarif.Files that needs to be mapped
     * @param runId id of the run these files are from
     */
    public async mapFiles(files: sarif.Artifact[], runId: number): Promise<void> {
        this.userCanceledMapping = false;
        if (files) {
            for (const fileIndex of files.keys()) {
                const file: sarif.Artifact = files[fileIndex];
                const fileLocation: sarif.Location | undefined = file.location;

                if (fileLocation) {
                    const uriBase: string | undefined = Utilities.getUriBase(fileLocation, runId);
                    const uriWithBase: Uri = Utilities.combineUriWithUriBase(fileLocation.uri, uriBase);

                    const key: string = Utilities.getFsPathWithFragment(uriWithBase);
                    if (file.contents) {
                        this.mapEmbeddedContent(key, file);
                    } else {
                        await this.map(uriWithBase, uriBase);
                    }

                    const index: string = `${runId}_${fileIndex}`;
                    this.fileIndexKeyMapping.set(index, key);
                }
            }
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
            this.fileRemapping.set(key, uri);
        } else {
            this.fileRemapping.delete(key);
        }
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
     * @param file file object that contains the hash and embedded content
     */
    private mapEmbeddedContent(fileKey: string, file: sarif.Artifact): void {
        const hashValue: string = this.getHashValue(file.hashes);
        const tempPath: string = Utilities.generateTempPath(fileKey, hashValue);

        let contents: string | undefined;
        if (file.contents &&  file.contents.text) {
            contents = file.contents.text;
        } else if (file.contents && file.contents.binary) {
            contents = Buffer.from(file.contents.binary, "base64").toString();
        }

        if (contents) {
            Utilities.createReadOnlyFile(tempPath, contents);
            this.addToFileMapping(fileKey, Uri.file(tempPath));
        }
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
                        this.userCanceledMapping = true;
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
        if (uriBase) {
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
            const oldRootpaths: string[] = this.rootpaths;
            this.rootpaths = (sarifConfig.get(this.configRootpaths) as string[]).filter((value, index, array) => {
                return value !== this.rootpathSample;
            });

            if (oldRootpaths !== undefined && this.rootpaths.toString() !== oldRootpaths.toString()) {
                this.updateMappingsWithRootPaths();
            }
        }
    }

    /**
     * Goes through the filemappings and tries to remap any that aren't mapped(null) using the rootpaths
     */
    private updateMappingsWithRootPaths(): void {
        let remapped: boolean = false;
        this.fileRemapping.forEach((value: Uri, key: string, map: Map<string, Uri>) => {
            remapped = remapped || this.tryConfigRootpathsUri(Uri.file(key), undefined);
        });

        if (remapped) {
            this.onMappingChanged.fire();
        }
    }
}
