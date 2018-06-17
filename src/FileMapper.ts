// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    ConfigurationChangeEvent, Disposable, Event, EventEmitter, OpenDialogOptions, Uri, window, workspace,
} from "vscode";
import { Utilities } from "./Utilities";

/**
 * Handles mapping file locations if the file is not in the location specified in the sarif file
 * Maintains a mapping of the files that have been remapped
 * Maintains a mapping of the base of the remapped files to try to apply to files that can't be found
 */
export class FileMapper {
    public static readonly MapCommand = "extension.sarif.Map";
    private static readonly FilesNotFoundMsg = `Source files were not found. Would you like to:
    * Map: choose the files to map them
    * Later: Skip mapping the files`;
    private static readonly SarifViewerTempFolder = "SarifViewerExtension";
    private static instance: FileMapper;

    private baseRemapping: Map<string, string>;
    private fileRemapping: Map<string, Uri>;
    private onMappingChanged: EventEmitter<Uri>;
    private userCanceledMapping: boolean;
    private showedMsgBox: boolean;
    private os;
    private pt;
    private fs;
    private rootpaths: string[];
    private changeConfigDisposable: Disposable;

    private constructor() {
        this.baseRemapping = new Map<string, string>();
        this.fileRemapping = new Map<string, Uri>();
        this.onMappingChanged = new EventEmitter<Uri>();

        this.pt = require("path");
        this.os = require("os");
        this.fs = require("fs");

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
        return this.openFilePicker(origUri).then((uris) => {
            if (uris !== undefined) {
                this.fileRemapping.set(origUri.path, uris[0]);
                this.saveBasePath(origUri, uris[0]);

                this.onMappingChanged.fire(origUri);
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
     * @param showMsgBox Flag that determines if the msg box letting the user know files need to be mapped is shown
     * @param showOpenDialog Flag that determines if the Open Dialog will be shown to let the user try to map
     */
    public async map(uri: Uri, showMsgBox?: boolean, showOpenDialog?: boolean): Promise<void> {
        // check if the file has already been remapped and the mapping isn't null(previously failed to map)
        if (this.fileRemapping.has(uri.path) && this.fileRemapping.get(uri.path) !== null) {
            return Promise.resolve();
        }

        if (this.tryMapUri(uri)) {
            return Promise.resolve();
        }

        if (this.tryRebaseUri(uri)) {
            return Promise.resolve();
        }

        if (this.tryConfigRootpathsUri(uri)) {
            return Promise.resolve();
        }

        // Last option is to tell the user we can't find files and ask them where the file is,
        // and we will generate a mapping and a base mapping from that location
        if (!this.showedMsgBox) {
            await window.showWarningMessage(FileMapper.FilesNotFoundMsg, { modal: true }, { title: "Map" },
                { title: "Later", isCloseAffordance: true }).then((value) => {
                    if (value.isCloseAffordance) {
                        this.userCanceledMapping = true;
                    }
                });
            this.showedMsgBox = true;
        }

        // if user canceled or previously canceled mapping we don't open the file chooser
        if (this.userCanceledMapping) {
            this.fileRemapping.set(uri.path, null);
            return Promise.resolve();
        }

        return this.getUserToChooseFile(uri);
    }

    /**
     * Call to map the files in the Sarif run files object
     * @param files dictionary of sarif.Files that needs to be mapped
     * @param showMsgBox Flag that determines if the msg box letting the user know files need to be mapped is shown
     * @param showOpenDialog Flag that determines if the Open Dialog will be shown to let the user try to map
     */
    public async mapFiles(files: { [key: string]: sarif.File }, showMsgBox?: boolean, showOpenDialog?: boolean) {
        this.showedMsgBox = false;
        this.userCanceledMapping = false;

        for (const file in files) {
            if (files.hasOwnProperty(file)) {
                const fileUri = Uri.parse(file);
                if (files[file].contents !== undefined) {
                    this.mapEmbeddedContent(fileUri, files[file]);
                } else {
                    await this.map(fileUri, showMsgBox && !this.showedMsgBox,
                        showOpenDialog && !this.userCanceledMapping);
                }
            }
        }
    }

    /**
     * Loops through the passed in path's directories and creates the directory structure
     * @param path directory path that needs to be created in temp directory(including temp directory)
     */
    private createDirectoryInTemp(path: string): string {
        const directories = path.split(this.pt.sep);
        let createPath: string = this.os.tmpdir();

        for (const directory of directories) {
            createPath = this.pt.join(createPath, directory);
            try {
                this.fs.mkdirSync(createPath);
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
            this.fs.unlinkSync(path);
        } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
        }

        this.fs.writeFileSync(path, contents, { mode: 0o444/*readonly*/ });
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

        const pathObj = this.pt.parse(fileUri.fsPath);
        let path = this.pt.join(FileMapper.SarifViewerTempFolder, hashValue, pathObj.dir.replace(pathObj.root, ""));
        path = this.createDirectoryInTemp(path);
        path = this.pt.join(path, this.pt.win32.basename(fileUri.fsPath));

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
     * Shows the Open File Picker for getting the user to select the mapping
     * @param uri used to pull the file's extension and initial open path
     */
    private async openFilePicker(uri: Uri): Promise<Uri[]> {
        const openOptions: OpenDialogOptions = Object.create(null);
        openOptions.canSelectFiles = true;
        openOptions.canSelectFolders = false;
        openOptions.canSelectMany = false;
        openOptions.openLabel = "Map";
        if (uri.scheme === "file") {
            openOptions.defaultUri = uri;
        }

        const index = uri.fsPath.lastIndexOf(".");
        if (index !== -1) {
            const ext = uri.fsPath.substring(index + 1);
            openOptions.filters = { file: [ext] };
        }

        return window.showOpenDialog(openOptions);
    }

    /**
     * Recursivly removes all of the contents in a directory, including subfolders
     * @param path directory to remove all contents from
     */
    private removeDirectoryContents(path: string): void {
        const contents = this.fs.readdirSync(path);
        for (const content of contents) {
            const contentPath = this.pt.join(path, content);
            if (this.fs.lstatSync(contentPath).isDirectory()) {
                this.removeDirectoryContents(contentPath);
                this.fs.rmdirSync(contentPath);
            } else {
                this.fs.unlinkSync(contentPath);
            }
        }
    }

    /**
     * Handles cleaning up the Sarif Viewer temp directory used for embeded code
     */
    private removeSarifViewerTempDirectory(): void {
        const path = this.pt.join(this.os.tmpdir(), FileMapper.SarifViewerTempFolder);
        this.removeDirectoryContents(path);
        this.fs.rmdirSync(path);
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
     * Check if the file exists at the provided path, if so it will map it
     * @param uri file uri to check if exists
     * @param key optional key to use for mapping, if not defined will use @param fileUri.path as key
     */
    private tryMapUri(uri: Uri, key?: string): boolean {
        try {
            this.fs.statSync(uri.fsPath);
            this.fileRemapping.set(key || uri.path, uri);
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
        const originPath = this.pt.parse(uri.fsPath);
        const dir: string = originPath.dir.replace(originPath.root, "");

        for (const rootpath of this.rootpaths) {
            const dirParts: string[] = dir.split(this.pt.sep);
            dirParts.push(originPath.base);

            while (dirParts.length !== 0) {
                const mappedUri = Uri.file(this.pt.join(rootpath, dirParts.join(this.pt.sep)));
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
            this.rootpaths = (sarifConfig.get("rootpaths") as string[]).filter((value, index, array) => {
                return value !== "c:\\sample\\path";
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
