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
                await this.map(fileUri, showMsgBox && !this.showedMsgBox,
                    showOpenDialog && !this.userCanceledMapping);
            }
        }
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
            // file could not be found
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
