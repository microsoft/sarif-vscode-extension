// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import {
    ConfigurationChangeEvent, Disposable, Event, EventEmitter, OpenDialogOptions, QuickInputButton, Uri,
    window, workspace,
} from "vscode";
import { sarif } from "./common/SARIFInterfaces";
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
    private onMappingChanged: EventEmitter<Uri>;
    private userCanceledMapping: boolean;
    private rootpaths: string[];
    private readonly rootpathSample = "c:\\sample\\path";
    private readonly configRootpaths = "rootpaths";
    private changeConfigDisposable: Disposable;

    private constructor() {
        this.baseRemapping = new Map<string, string>();
        this.fileRemapping = new Map<string, Uri>();
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
     * @param uriBase the base path of the uri
     */
    public async get(fileUri: Uri, uriBase?: string): Promise<Uri> {
        const uri = Utilities.combineUriWithUriBase(fileUri.toString(true), uriBase);
        const uriPath = Utilities.getFsPathWithFragment(uri);
        if (!this.fileRemapping.has(uriPath)) {
            await this.map(uri, uriBase);
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
        const oldProgressMsg = ProgressHelper.Instance.CurrentMessage;
        await ProgressHelper.Instance.setProgressReport("Waiting for user input");
        return this.openRemappingInputDialog(origUri).then(async (path) => {
            if (path === null) {
                // path is null if the skip next button was pressed
                this.fileRemapping.set(Utilities.getFsPathWithFragment(origUri), null);
            } else if (path === undefined) {
                // path is undefined if the input was dismissed without fixing the path
                this.userCanceledMapping = true;
                this.fileRemapping.set(Utilities.getFsPathWithFragment(origUri), null);
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
                        this.fileRemapping.set(Utilities.getFsPathWithFragment(origUri), null);
                    }
                } else {
                    this.fileRemapping.set(Utilities.getFsPathWithFragment(origUri), uri);
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
            this.fileRemapping.set(uriPath, null);
            return Promise.resolve();
        }

        // If not able to remap using other means, we need to ask the user to enter a path for remapping
        return this.getUserToChooseFile(uri, uriBase);
    }

    /**
     * Call to map the files in the Sarif run files object
     * @param files dictionary of sarif.Files that needs to be mapped
     * @param runId id of the run these files are from
     */
    public async mapFiles(files: { [key: string]: sarif.File }, runId: number) {
        this.userCanceledMapping = false;
        for (const file in files) {
            if (files.hasOwnProperty(file)) {
                let uriPath: string;
                let fileLocation = files[file].fileLocation;
                // Files with uribaseids are in format #uribaseid#/folder/file.ext
                if (file.startsWith("#")) {
                    const fileSplit = file.split("#");
                    fileSplit.shift(); // because the first character is the seperator # the first item is ""
                    fileLocation = { uriBaseId: fileSplit[0] } as sarif.FileLocation;
                    fileSplit.shift();
                    uriPath = fileSplit.join("#");
                } else {
                    uriPath = file;
                }

                const uriBase = Utilities.getUriBase(fileLocation, runId);
                const uriWithBase = Utilities.combineUriWithUriBase(uriPath, uriBase);

                if (files[file].contents !== undefined) {
                    this.mapEmbeddedContent(Uri.parse(uriPath), files[file]);
                } else {
                    await this.map(uriWithBase, uriBase);
                }
            }
        }
    }

    /**
     * Gets the hash value for the embedded content. Preference for sha256, if not found it uses the first hash value
     * @param hashes Array of hash objects
     */
    private getHashValue(hashes: sarif.Hash[]): string {
        if (hashes !== undefined) {
            const sha256Hash = hashes.find((value, index) => {
                return value.algorithm === "sha256";
            });

            if (sha256Hash !== undefined) {
                return sha256Hash.value;
            } else {
                return hashes[0].value;
            }
        } else {
            return "";
        }
    }

    /**
     * Creates a temp file with the decoded content and adds the new temp file to the mapping
     * @param fileUri file Uri that needs to be mapped
     * @param file file object that contains the hash and embedded content
     */
    private mapEmbeddedContent(fileUri: Uri, file: sarif.File): void {
        const hashValue = this.getHashValue(file.hashes);
        const fileUriPath = Utilities.getFsPathWithFragment(fileUri);
        const tempPath = Utilities.generateTempPath(fileUriPath, hashValue);

        let contents: string;
        if (file.contents.text !== undefined) {
            contents = file.contents.text;
        } else {
            contents = Buffer.from(file.contents.binary, "base64").toString();
        }

        Utilities.createReadOnlyFile(tempPath, contents);
        this.fileRemapping.set(fileUriPath, Uri.file(tempPath));
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
                    this.fileRemapping.set(key, uri);
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
                const mappedUri = Uri.file(Utilities.Path.join(rootpath, dirParts.join(Utilities.Path.sep)));
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
