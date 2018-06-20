// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    ConfigurationChangeEvent, Disposable, Event, EventEmitter, InputBoxOptions, Uri, window, workspace,
} from "vscode";
import { Utilities } from "./Utilities";

/**
 * Handles mapping file locations if the file is not in the location specified in the sarif file
 * Maintains a mapping of the files that have been remapped
 * Maintains a mapping of the base of the remapped files to try to apply to files that can't be found
 */
export class FileMapper {
    public static readonly MapCommand = "extension.sarif.Map";
    private static readonly SarifViewerTempDir = "SarifViewerExtension";
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
        this.removeSarifViewerTempDirectory();
    }

    /**
     * Gets the mapped Uri associated with the passed in file, promise returns null if not able to map
     * @param filePath Uri of the file
     */
    public async get(fileUri: Uri): Promise<Uri> {
        if (!this.fileRemapping.has(fileUri.path)) {
            await this.map(fileUri);
        }

        return this.fileRemapping.get(fileUri.path);
    }

    /**
     * Opens a dialog for the user to select the file location to map the file to
     * Saves the mapping, base mapping
     * @param origUri Uri the user needs to remap
     */
    public async getUserToChooseFile(origUri: Uri): Promise<void> {
        return this.openFilePicker(origUri).then((path) => {
            if (path !== undefined) {
                const uri = Uri.parse(path);
                if (Utilities.Path.extname(path) === "") {
                    const config = workspace.getConfiguration(Utilities.configSection);
                    const rootpaths: string[] = config.get(this.configRootpaths);

                    if (rootpaths.length === 1 && rootpaths[0] === this.rootpathSample) {
                        rootpaths.pop();
                    }

                    rootpaths.push(Utilities.getDisplayableRootpath(uri));
                    this.rootpaths = rootpaths;
                    config.update(this.configRootpaths, rootpaths, true);

                    if (!this.tryConfigRootpathsUri(origUri)) {
                        this.fileRemapping.set(origUri.path, null);
                    }
                } else {
                    this.fileRemapping.set(origUri.path, uri);
                    this.saveBasePath(origUri, uri);

                    this.onMappingChanged.fire(origUri);
                }
            } else {
                this.userCanceledMapping = true;
                this.fileRemapping.set(origUri.path, null);
            }

            return Promise.resolve();
        });
    }

    /**
     * Tries to map the passed in uri to a file location
     * @param uri Uri that needs to be mapped
     */
    public async map(uri: Uri): Promise<void> {
        // check if the file has already been remapped and the mapping isn't null(previously failed to map)
        if (this.fileRemapping.has(uri.path) && this.fileRemapping.get(uri.path) !== null) {
            return Promise.resolve();
        }

        if (this.tryMapUri(uri, uri.path)) {
            return Promise.resolve();
        }

        if (this.tryRebaseUri(uri)) {
            return Promise.resolve();
        }

        if (this.tryConfigRootpathsUri(uri)) {
            return Promise.resolve();
        }

        // if user previously canceled mapping we don't open the file chooser
        if (this.userCanceledMapping) {
            this.fileRemapping.set(uri.path, null);
            return Promise.resolve();
        }

        // If not able to remap using other means, we need to ask the user to enter a path for remapping
        return this.getUserToChooseFile(uri);
    }

    /**
     * Call to map the files in the Sarif run files object
     * @param files dictionary of sarif.Files that needs to be mapped
     */
    public async mapFiles(files: { [key: string]: sarif.File }) {
        this.userCanceledMapping = false;

        for (const file in files) {
            if (files.hasOwnProperty(file)) {
                const fileUri = Uri.parse(file);
                if (files[file].contents !== undefined) {
                    this.mapEmbeddedContent(fileUri, files[file]);
                } else {
                    await this.map(fileUri);
                }
            }
        }
    }

    /**
     * Loops through the passed in path's directories and creates the directory structure
     * @param path directory path that needs to be created in temp directory(including temp directory)
     */
    private createDirectoryInTemp(path: string): string {
        const directories = path.split(Utilities.Path.sep);
        let createPath: string = Utilities.Os.tmpdir();

        for (const directory of directories) {
            createPath = Utilities.Path.join(createPath, directory);
            try {
                Utilities.Fs.mkdirSync(createPath);
            } catch (error) {
                if (error.code !== "EEXIST") { throw error; }
            }
        }

        return createPath;
    }

    /**
     * Creates a readonly file at the path with the contents specified
     * If the file already exists method will delete that file and replace it with the new one
     * @param path path to create the file in
     * @param contents content to add to the file after created
     */
    private createReadOnlyFile(path: string, contents: string): void {
        try {
            Utilities.Fs.unlinkSync(path);
        } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
        }

        Utilities.Fs.writeFileSync(path, contents, { mode: 0o444/*readonly*/ });
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

        const pathObj = Utilities.Path.parse(fileUri.fsPath);
        let path = Utilities.Path.join(FileMapper.SarifViewerTempDir, hashValue, pathObj.dir.replace(pathObj.root, ""));
        path = this.createDirectoryInTemp(path);
        path = Utilities.Path.join(path, Utilities.Path.win32.basename(fileUri.fsPath));

        let contents: string;
        if (file.contents.text !== undefined) {
            contents = file.contents.text;
        } else {
            contents = Buffer.from(file.contents.binary, "base64").toString();
        }

        this.createReadOnlyFile(path, contents);
        this.fileRemapping.set(fileUri.path, Uri.file(path));
    }

    /**
     * Shows the Inputbox with message for getting the user to select the mapping
     * @param uri uri of the file that needs to be mapped
     */
    private async openFilePicker(uri: Uri): Promise<string> {
        const inputOptions = {
            ignoreFocusOut: true,
            prompt: "Valid path has been entered",
            validateInput: (path: string): string => {
                let validateMsg;
                const validateUri = Uri.parse(path);
                if (!this.tryMapUri(validateUri)) {
                    validateMsg = `'${uri.toString(true)}' can not be found.
                Correct the path to: the local file (file:///c:/example/repo1/source.js) for this session or the local
                rootpath (c:/example/repo1/) to add it to the user settings (Press 'Escape' to cancel)`;
                } else {
                    const displayablePath = Utilities.getDisplayableRootpath(validateUri);
                    if (this.rootpaths.indexOf(displayablePath) !== -1) {
                        validateMsg = `'${displayablePath}' already exists in the settings (sarif-viewer.rootpaths),
                        please try a different path (Press 'Escape' to cancel)`;
                    }
                }

                return validateMsg;
            },
            value: uri.toString(true),
        } as InputBoxOptions;

        return window.showInputBox(inputOptions);
    }

    /**
     * Recursivly removes all of the contents in a directory, including subfolders
     * @param path directory to remove all contents from
     */
    private removeDirectoryContents(path: string): void {
        const contents = Utilities.Fs.readdirSync(path);
        for (const content of contents) {
            const contentPath = Utilities.Path.join(path, content);
            if (Utilities.Fs.lstatSync(contentPath).isDirectory()) {
                this.removeDirectoryContents(contentPath);
                Utilities.Fs.rmdirSync(contentPath);
            } else {
                Utilities.Fs.unlinkSync(contentPath);
            }
        }
    }

    /**
     * Handles cleaning up the Sarif Viewer temp directory used for embeded code
     */
    private removeSarifViewerTempDirectory(): void {
        const path = Utilities.Path.join(Utilities.Os.tmpdir(), FileMapper.SarifViewerTempDir);
        this.removeDirectoryContents(path);
        Utilities.Fs.rmdirSync(path);
    }

    /**
     * Determines the base path of the remapped Uri. Does so by
     * starting at the end of both pathes character compares
     * when it finds a mismatch it uses the index as the end of the substring of the bases for each path
     * @param originalUri Uri found in the sarif file
     * @param remappedUri Uri the originalUri has been successfully mapped to
     */
    private saveBasePath(originalUri: Uri, remappedUri: Uri) {
        const oPath = originalUri.toString(true);
        const rPath = remappedUri.toString(true);
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
     * @param uri file uri to check if exists
     * @param key key used for mapping, if undefined the mapping won't be added if it exists
     */
    private tryMapUri(uri: Uri, key?: string): boolean {
        try {
            Utilities.Fs.statSync(uri.fsPath);
            if (key !== undefined) {
                this.fileRemapping.set(key, uri);
            }
            return true;
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
                if (this.tryMapUri(mappedUri, uri.path)) {
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
    private tryConfigRootpathsUri(uri: Uri): boolean {
        const originPath = Utilities.Path.parse(uri.fsPath);
        const dir: string = originPath.dir.replace(originPath.root, "");

        for (const rootpath of this.rootpaths) {
            const dirParts: string[] = dir.split(Utilities.Path.sep);
            dirParts.push(originPath.base);

            while (dirParts.length !== 0) {
                const mappedUri = Uri.file(Utilities.Path.join(rootpath, dirParts.join(Utilities.Path.sep)));
                if (this.tryMapUri(mappedUri, uri.path)) {
                    this.saveBasePath(uri, mappedUri);
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
                if (this.tryConfigRootpathsUri(Uri.file(key))) {
                    remapped = true;
                }
            }
        });

        if (remapped) {
            this.onMappingChanged.fire();
        }
    }
}
