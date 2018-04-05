// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Event, EventEmitter, OpenDialogOptions, Uri, window } from "vscode";

/**
 * Handles mapping file locations if the file is not in the location specified in the sarif file
 * Maintains a mapping of the files that have been remapped
 * Maintains a mapping of the base of the remapped files to try to apply to files that can't be found
 */
export class FileMapper {
    public static readonly MapCommand = "extension.sarif.Map";
    private static readonly FilesNotFoundMsg = "Source files were not found. Would you like to map them now?";
    private static readonly SarifViewerTempFolder = "SarifViewerExtension";
    private static instance: FileMapper;

    private baseRemapping: Map<string, string>;
    private fileRemapping: Map<string, Uri>;
    private onMappingChanged: EventEmitter<Uri>;
    private userCanceledMapping: boolean;
    private showedMsgBox: boolean;

    private constructor() {
        this.baseRemapping = new Map<string, string>();
        this.fileRemapping = new Map<string, Uri>();
        this.onMappingChanged = new EventEmitter<Uri>();
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
        this.removeSarifViewerTempDirectory();
    }

    /**
     * Gets the mapped Uri associated with the passed in file, promise returns null if not able to map
     * @param filePath path to the file
     */
    public async get(filePath: string): Promise<Uri> {
        const fileUri = Uri.parse(filePath);
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
     * @param uri Uri that needs to be mapped
     * @param showMsgBox Flag that determines if the msg box letting the user know files need to be mapped is shown
     * @param showOpenDialog Flag that determines if the Open Dialog will be shown to let the user try to map
     */
    public async mapFiles(files: Map<string, sarif.File>, showMsgBox?: boolean, showOpenDialog?: boolean) {
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
        const pt = require("path");
        const os = require("os");
        const fs = require("fs");
        const directories = path.split(pt.sep);
        let createPath: string = os.tmpdir();

        for (const directory of directories) {
            createPath = pt.join(createPath, directory);
            try {
                fs.mkdirSync(createPath);
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
        const fs = require("fs");

        try {
            fs.unlinkSync(path);
        } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
        }

        fs.writeFileSync(path, contents, { mode: 0o444/*readonly*/ });
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
        const pt = require("path");

        const hashValue = this.getHashValue(file.hashes);

        const pathObj = pt.parse(fileUri.fsPath);
        let path = pt.join(FileMapper.SarifViewerTempFolder, hashValue, pathObj.dir.replace(pathObj.root, ""));
        path = this.createDirectoryInTemp(path);
        path = pt.join(path, pt.win32.basename(fileUri.fsPath));

        const contents = Buffer.from(file.contents, "base64").toString();

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
        openOptions.defaultUri = uri;

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
        const fs = require("fs");
        const pt = require("path");

        const contents = fs.readdirSync(path);
        for (const content of contents) {
            const contentPath = pt.join(path, content);
            if (fs.lstatSync(contentPath).isDirectory()) {
                this.removeDirectoryContents(contentPath);
                fs.rmdirSync(contentPath);
            } else {
                fs.unlinkSync(contentPath);
            }
        }
    }

    /**
     * Handles cleaning up the Sarif Viewer temp directory used for embeded code
     */
    private removeSarifViewerTempDirectory(): void {
        const fs = require("fs");
        const os = require("os");
        const pt = require("path");

        const path = pt.join(os.tmpdir(), FileMapper.SarifViewerTempFolder);
        this.removeDirectoryContents(path);
        fs.rmdirSync(path);
    }

    /**
     * Determines the base path of the remapped Uri. Does so by
     * starting at the end of both pathes character compares
     * when it finds a mismatch it uses the index as the end of the substring of the bases for each path
     * @param originalUri Uri found in the sarif file
     * @param remappedUri Uri the originalUri has been successfully mapped to
     */
    private saveBasePath(originalUri: Uri, remappedUri: Uri) {
        const oPath = originalUri.toString();
        const rPath = remappedUri.toString();
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
        const fs = require("fs");
        try {
            fs.statSync(uri.fsPath);
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
            const uriText = uri.toString();
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
}
