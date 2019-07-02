// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    ConfigurationChangeEvent, Disposable, Event, EventEmitter, OpenDialogOptions, QuickInputButton, Uri,
    window, workspace,
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
    private userCanceledMapping: boolean;
    private rootpaths: string[];
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
        Promise<{ mapped: boolean, uri: Uri }> {
        let uriPath: string;
        if (location.index !== undefined) {
            uriPath = this.fileIndexKeyMapping.get(`${runId}_${location.index}`);
        } else {
            const uri = Utilities.combineUriWithUriBase(location.uri, uriBase);
            uriPath = Utilities.getFsPathWithFragment(uri);
            if (!this.fileRemapping.has(uriPath)) {
                await this.map(uri, uriBase);
            }

        }

        const mappedUri = this.fileRemapping.get(uriPath);
        const returnData = {
            mapped: true,
            uri: mappedUri,
        };

        if (returnData.uri === null) {
            returnData.mapped = false;
            returnData.uri = Uri.parse(uriPath);
        }

        return returnData;
    }

    /**
     * Opens a dialog for the user to select the file location to map the file to
     * Saves the mapping, base mapping
     * @param origUri Uri the user needs to remap, if it has a uriBase it should be included in this uri
     * @param uriBase the base path of the uri
     */
    public async getUserToChooseFile(origUri: Uri, uriBase: string): Promise<void> {
        const oldProgressMsg = ProgressHelper.Instance.CurrentMessage;
        await ProgressHelper.Instance.setProgressReport("Waiting for user input");
        return this.openRemappingInputDialog(origUri).then(async (path) => {
            if (path === null) {
                // path is null if the skip next button was pressed
                this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), null);
            } else if (path === undefined) {
                // path is undefined if the input was dismissed without fixing the path
                this.userCanceledMapping = true;
                this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), null);
            } else {
                const uri = Uri.file(path);
                const filePath: string = Utilities.getFsPathWithFragment(uri);

                if (Utilities.Fs.statSync(filePath).isDirectory()) {
                    const config = workspace.getConfiguration(Utilities.configSection);
                    const rootpaths: string[] = config.get(this.configRootpaths);

                    if (rootpaths.length === 1 && rootpaths[0] === this.rootpathSample) {
                        rootpaths.pop();
                    }

                    rootpaths.push(Utilities.getDisplayableRootpath(uri));
                    this.rootpaths = rootpaths;
                    config.update(this.configRootpaths, rootpaths, true);

                    if (!this.tryConfigRootpathsUri(origUri, uriBase)) {
                        this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), null);
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
            }

            await ProgressHelper.Instance.setProgressReport(oldProgressMsg);
            return Promise.resolve();
        });
    }

    /**
     * Tries to map the passed in uri to a file location
     * @param uri Uri that needs to be mapped, should already have uribase included
     * @param uriBase the base path of the uri
     */
    public async map(uri: Uri, uriBase: string): Promise<void> {
        // check if the file has already been remapped and the mapping isn't null(previously failed to map)
        const uriPath = Utilities.getFsPathWithFragment(uri);
        if (this.fileRemapping.has(uriPath) && this.fileRemapping.get(uriPath) !== null) {
            return Promise.resolve();
        }

        if (this.tryMapUri(uri, uriPath)) {
            return Promise.resolve();
        }

        if (this.tryRebaseUri(uri)) {
            return Promise.resolve();
        }

        if (this.tryConfigRootpathsUri(uri, uriBase)) {
            return Promise.resolve();
        }

        // if user previously canceled mapping we don't open the file chooser
        if (this.userCanceledMapping) {
            this.addToFileMapping(uriPath, null);
            return Promise.resolve();
        }

        // If not able to remap using other means, we need to ask the user to enter a path for remapping
        return this.getUserToChooseFile(uri, uriBase);
    }

    /**
     * Call to map the files in the Sarif run files object
     * @param files array of sarif.Files that needs to be mapped
     * @param runId id of the run these files are from
     */
    public async mapFiles(files: sarif.Artifact[], runId: number) {
        this.userCanceledMapping = false;
        if (files !== undefined) {
            for (const fileIndex of files.keys()) {
                const file = files[fileIndex];
                const fileLocation = file.location;

                if (fileLocation !== undefined) {
                    const uriBase = Utilities.getUriBase(fileLocation, runId);
                    const uriWithBase = Utilities.combineUriWithUriBase(fileLocation.uri, uriBase);

                    const key = Utilities.getFsPathWithFragment(uriWithBase);
                    if (file.contents !== undefined) {
                        this.mapEmbeddedContent(key, file);
                    } else {
                        await this.map(uriWithBase, uriBase);
                    }

                    const index = `${runId}_${fileIndex}`;
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
    private addToFileMapping(key: string, uri: Uri = null): void {
        if (uri !== null) {
            uri.toString();
        }

        this.fileRemapping.set(key, uri);
    }

    /**
     * Gets the hash value for the embedded content. Preference for sha256, if not found it uses the first hash value
     * @param hashes dictionary of hashes
     */
    private getHashValue(hashes: { [key: string]: string; }): string {
        let value = "";
        if (hashes !== undefined) {
            const sha256Key = "sha256";
            if (hashes[sha256Key] !== undefined) {
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
        const hashValue = this.getHashValue(file.hashes);
        const tempPath = Utilities.generateTempPath(fileKey, hashValue);

        let contents: string;
        if (file.contents.text !== undefined) {
            contents = file.contents.text;
        } else {
            contents = Buffer.from(file.contents.binary, "base64").toString();
        }

        Utilities.createReadOnlyFile(tempPath, contents);
        this.addToFileMapping(fileKey, Uri.file(tempPath));
    }

    /**
     * Shows the Inputbox with message for getting the user to select the mapping
     * @param uri uri of the file that needs to be mapped
     */
    private async openRemappingInputDialog(uri: Uri): Promise<string> {
        const disposables: Disposable[] = [];
        let resolved = false;
        return new Promise<string>((resolve, rejected) => {
            const input = window.createInputBox();
            input.title = "Sarif Result Location Remapping";
            input.value = uri.fsPath;
            input.prompt = `Valid path, confirm if it maps to '${uri.fsPath}' or its rootpath`;
            input.validationMessage = `'${uri.fsPath}' can not be found.
        Correct the path to: the local file (c:/example/repo1/source.js) for this session or the local
        rootpath (c:/example/repo1/) to add it to the user settings (Press 'Escape' to cancel)`;
            input.ignoreFocusOut = true;

            input.buttons = new Array<QuickInputButton>(
                { iconPath: Utilities.IconsPath + "open-folder.svg", tooltip: "Open file picker" } as QuickInputButton,
                { iconPath: Utilities.IconsPath + "next.svg", tooltip: "Skip to next" } as QuickInputButton,
            );

            disposables.push(input.onDidAccept(() => {
                if (input.validationMessage === undefined) {
                    resolved = true;
                    input.hide();
                    resolve(input.value);
                }
            }));

            disposables.push(input.onDidHide(() => {
                disposables.forEach((dis: Disposable) => {
                    dis.dispose();
                });

                if (!resolved) {
                    resolve(undefined);
                }
            }));

            disposables.push(input.onDidTriggerButton((button) => {
                switch (button.iconPath) {
                    case Utilities.IconsPath + "open-folder.svg":
                        const openOptions: OpenDialogOptions = Object.create(null);
                        openOptions.canSelectMany = false;
                        openOptions.openLabel = "Map";

                        window.showOpenDialog(openOptions).then((selectedUris) => {
                            if (selectedUris !== undefined && selectedUris[0] !== undefined) {
                                input.value = selectedUris[0].fsPath;
                                input.validationMessage = undefined;
                            }
                        });
                        break;
                    case Utilities.IconsPath + "next.svg":
                        resolved = true;
                        input.hide();
                        resolve(null);
                        break;
                }
            }));

            disposables.push(input.onDidChangeValue(() => {
                const path = input.value;
                let message = `'${uri.fsPath}' can not be found.
                Correct the path to: the local file (c:/example/repo1/source.js) for this session or the local
                rootpath (c:/example/repo1/) to add it to the user settings (Press 'Escape' to cancel)`;

                if (path !== undefined && path !== "") {
                    let validateUri: Uri;
                    let isDirectory;
                    try {
                        validateUri = Uri.file(path);
                    } catch (error) {
                        if (error.message !== "URI malformed") { throw error; }
                    }

                    if (validateUri !== undefined) {
                        try {
                            isDirectory = Utilities.Fs.statSync(validateUri.fsPath).isDirectory();
                        } catch (error) {
                            if (error.code !== "ENOENT") { throw error; }
                        }

                        if (isDirectory === true) {
                            message = undefined;
                            if (this.rootpaths.indexOf(validateUri.fsPath) !== -1) {
                                message = `'${validateUri.fsPath}' already exists in the settings
                                    (sarif-viewer.rootpaths), please try a different path (Press 'Escape' to cancel)`;
                            }
                        } else if (isDirectory === false) {
                            if (this.tryMapUri(validateUri)) {
                                message = undefined;
                            }
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
    private saveBasePath(originalUri: Uri, remappedUri: Uri, uriBase: string) {
        const oPath = originalUri.toString(true);
        const rPath = remappedUri.toString(true);
        if (uriBase !== undefined) {
            const relativePath = oPath.substring(oPath.indexOf(uriBase) + uriBase.length);
            const index = rPath.indexOf(relativePath);
            if (index !== -1) {
                this.baseRemapping.set(oPath.replace(relativePath, ""), rPath.replace(relativePath, ""));
                return;
            }
        }

        for (let i = 1; i <= rPath.length; i++) {
            const oIndex = oPath.length - i;
            const rIndex = rPath.length - i;
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
            if (!Utilities.Fs.statSync(Utilities.getFsPathWithFragment(uri)).isDirectory()) {
                if (key !== undefined) {
                    this.addToFileMapping(key, uri);
                }
                return true;
            }
        } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
        }

        return false;
    }

    /**
     * Check if base can be remapped using any of the existing base mappings
     * @param uri file uri to try to rebase
     */
    private tryRebaseUri(uri: Uri): boolean {
        for (const [base, remappedBase] of this.baseRemapping.entries()) {
            const uriText = uri.toString(true);
            if (uriText.indexOf(base) === 0) {
                const newpath = uriText.replace(base, remappedBase);
                const mappedUri = Uri.parse(newpath);
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
    private tryConfigRootpathsUri(uri: Uri, uriBase: string): boolean {
        const originPath = Utilities.Path.parse(Utilities.getFsPathWithFragment(uri));
        const dir: string = originPath.dir.replace(originPath.root, "");

        for (const rootpath of this.rootpaths) {
            const dirParts: string[] = dir.split(Utilities.Path.sep);
            dirParts.push(originPath.base);

            while (dirParts.length !== 0) {
                const mappedUri = Uri.file(Utilities.joinPath(rootpath, dirParts.join(Utilities.Path.sep)));
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
    private updateRootPaths(event?: ConfigurationChangeEvent) {
        if (event === undefined || event.affectsConfiguration(Utilities.configSection)) {
            const sarifConfig = workspace.getConfiguration(Utilities.configSection);
            const oldRootpaths = this.rootpaths;
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
    private updateMappingsWithRootPaths() {
        let remapped = false;
        this.fileRemapping.forEach((value: Uri, key: string, map: Map<string, Uri>) => {
            if (value === null) {
                if (this.tryConfigRootpathsUri(Uri.file(key), undefined)) {
                    remapped = true;
                }
            }
        });

        if (remapped) {
            this.onMappingChanged.fire();
        }
    }
}
