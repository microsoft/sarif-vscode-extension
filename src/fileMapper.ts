/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as nls from 'vscode-nls';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import * as fs from "fs";
import * as path from "path";
import {
    ConfigurationChangeEvent, Disposable, Event, EventEmitter, QuickInputButton, Uri,
    window, workspace, WorkspaceConfiguration, InputBox, commands
} from "vscode";
import { ProgressHelper } from "./progressHelper";
import { Utilities } from "./utilities";
import { Location, MapLocationToLocalPathOptions } from "./common/interfaces";

const RootPathSample: string = 'c:\\sample\\path';
const ConfigRootPaths: string = 'rootpaths';
/**
 * Handles mapping file locations if the file is not in the location specified in the sarif file
 * Maintains a mapping of the files that have been remapped
 * Maintains a mapping of the base of the remapped files to try to apply to files that can't be found
 */
export class FileMapper implements Disposable {
    private disposables: Disposable[] = [];
    private static fileMapperInstance: FileMapper;
    private locationMappedEventEmitterMap: Map<Location, EventEmitter<Location>> = new Map<Location, EventEmitter<Location>>();

    public static readonly MapCommand = 'extension.sarif.Map';

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
     * Contains the root paths configured in the settings by the user or
     * paths automatically added when the user uses the remap UI flow.
     */
    private rootPaths: string[] = [];

    private constructor() {
        if (FileMapper.fileMapperInstance) {
            throw new Error('The file mapper should only be constructed once per extension session.');
        }

        FileMapper.fileMapperInstance = this;
        this.updateRootPaths();
        this.disposables.push(workspace.onDidChangeConfiguration(this.updateRootPaths, this));
        this.disposables.push(commands.registerCommand(FileMapper.MapCommand, this.mapFileCommand.bind(this)));
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
    }

    /**
     * Opens a dialog for the user to select the file location to map the file to
     * Saves the mapping, base mapping
     * @param origUri Uri the user needs to remap, if it has a uriBase it should be included in this uri
     * @param uriBase the base path of the uri
     */
    public async getUserToChooseFile(origUri: Uri, uriBase?: string): Promise<Uri | undefined> {
        const oldProgressMsg: string | undefined = ProgressHelper.Instance.CurrentMessage;
        await ProgressHelper.Instance.setProgressReport(localize('fileMapper.WaitingForUserInput', "Waiting for user input"));

        const remapResult: string | undefined = await this.openRemappingInputDialog(origUri);

        // If the user cancelled the mapping, then set undefined into the file mapping
        // map to indicate that.
        if (!remapResult) {
            this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), undefined);
            return undefined;
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
            this.rootPaths = rootpaths;
            await config.update(ConfigRootPaths, rootpaths, true);

            if (!this.tryConfigRootPathsUri(origUri, uriBase)) {
                this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), undefined);
            }
        } else {
            this.addToFileMapping(Utilities.getFsPathWithFragment(origUri), uri);
            this.saveBasePath(origUri, uri, uriBase);
            this.fileRemapping.forEach((value: Uri | undefined, key: string) => {
                if (!value) {
                    this.tryRebaseUri(Uri.file(key));
                }
            });
        }

        await ProgressHelper.Instance.setProgressReport(oldProgressMsg);

        return uri;
    }

    /**
     * Tries to map the passed in uri to a file location
     * @param uri Uri that needs to be mapped, should already have uribase included
     * @param uriBase the base path of the uri
     * @param options Indicates whether we wish to prompt the user or not.
     */
    private async map(uri: Uri, uriBase: string | undefined, options: MapLocationToLocalPathOptions): Promise<Uri | undefined> {
        // check if the file has already been remapped and the mapping isn't null(previously failed to map)
        const uriPath: string = Utilities.getFsPathWithFragment(uri);

        // If the mapping already done, then we're done.
        let mappedUri: Uri | undefined = this.fileRemapping.get(uriPath);
        if (mappedUri) {
            return mappedUri;
        }

        if (this.isLocalFile(uri, uriPath)) {
            return uri;
        }

        mappedUri = this.tryRebaseUri(uri);
        if (mappedUri) {
            return mappedUri;
        }

        mappedUri = this.tryConfigRootPathsUri(uri, uriBase);
        if (mappedUri) {
            return mappedUri;
        }

        // If not able to remap using other means, we need to ask the user to enter a path for remapping
        if (options.promptUser) {
            mappedUri = await this.getUserToChooseFile(uri, uriBase);
        }

        return mappedUri;
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
     * Shows the input box with message for getting the user to select the mapping
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
            disposables.push(input);

            input.title = localize('openRemappingInputDialog.title', "Sarif Result Location Remapping");
            input.value = uri.fsPath;
            input.prompt = localize("openRemappingInputDialog.prompt", "Valid path, confirm if it maps to '{0}' or its rootpath", uri.fsPath);
            input.validationMessage = localize('openRemappingInputDialog.validationMessage',
                "'{0}' can not be found.\r\nCorrect the path to: the local file (c:/example/repo1/source.js) for this session or the local rootpath (c:/example/repo1/) to add it to the user settings (Press 'Escape' to cancel)",
                uri.fsPath);
            input.ignoreFocusOut = true;

            input.buttons = <RemappingQuickInputButtons[]>[{
                iconPath: `${Utilities.IconsPath}open-folder.svg`,
                tooltip: localize('openRemappingInputDialog.openTooltip', "Open file picker"),
                remappingType: 'Open'
            }, {
                iconPath: `${Utilities.IconsPath}next.svg`,
                tooltip: localize('openRemappingInputDialog.skipTooltip', "Skip to next"),
                remappingType: 'Skip'
            }];

            disposables.push(input.onDidAccept(() => {
                if (resolvedString) {
                    input.hide();
                    resolve(resolvedString);
                }
            }));

            disposables.push(input.onDidHide(() => {
                Disposable.from(...disposables).dispose();
                resolve(resolvedString);
            }));

            disposables.push(input.onDidTriggerButton(async (button) => {
                switch ((<RemappingQuickInputButtons>button).remappingType) {
                    case 'Open':
                        const selectedUris: Uri[] | undefined = await window.showOpenDialog({
                            canSelectMany: false,
                            openLabel: localize('openRemappingInputDialog.openDialogLabel', "Map")
                        });

                        if (selectedUris && selectedUris.length === 1) {
                            input.value = selectedUris[0].fsPath;
                        }
                        break;

                    case 'Skip':
                        input.hide();
                        break;
                }
            }));

            disposables.push(input.onDidChangeValue(() => {
                const directory: string = input.value;
                let message: string | undefined =
                input.validationMessage = localize('openRemappingInputDialog.validationMessage',
                    "'{0}' can not be found.\r\nCorrect the path to: the local file (c:/example/repo1/source.js) for this session or the local rootpath (c:/example/repo1/) to add it to the user settings (Press 'Escape' to cancel)",
                    uri.fsPath);

                if (directory && directory.length !== 0) {
                    let validateUri: Uri | undefined;
                    let isDirectory: boolean = false;

                    try {
                        validateUri = Uri.file(directory);
                    } catch (error) {
                        if (error.message !== 'URI malformed') {
                            throw error;
                        }
                    }

                    if (validateUri) {
                        try {
                            isDirectory = fs.statSync(validateUri.fsPath).isDirectory();
                        } catch (error) {
                            switch (error.code) {
                                // Path not found.
                                case 'ENOENT':
                                    break;

                                case 'UNKNOWN':
                                    if (validateUri.authority !== '') {
                                        break;
                                    }
                                    throw error;

                                default:
                                    throw error;
                            }
                        }

                        if (isDirectory) {
                            const rootPathIndex: number = this.rootPaths.indexOf(validateUri.fsPath);
                            if (rootPathIndex !== -1) {
                                message = localize('openRemappingInputDialog.alreadyExistsInRoot', "'{0}' already exists in the settings (sarif-viewer.rootpaths), please try a different path (Press 'Escape' to cancel)", validateUri.fsPath);
                            } else {
                                resolvedString = this.rootPaths[rootPathIndex];
                                input.hide();
                            }
                        } else if (this.isLocalFile(validateUri)) {
                            message = undefined;
                            resolvedString = validateUri.fsPath;
                            input.hide();
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
                this.baseRemapping.set(oPath.replace(relativePath, ''), rPath.replace(relativePath, ''));
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
    private isLocalFile(uri: Uri, key?: string): boolean {
        try {
            if (!fs.statSync(Utilities.getFsPathWithFragment(uri)).isDirectory()) {
                if (key !== undefined) {
                    this.addToFileMapping(key, uri);
                }
                return true;
            }
        } catch (error) {
            switch (error.code) {
                case 'ENOENT':
                    break;

                case 'UNKNOWN':
                    if (uri.authority !== '') {
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
    private tryRebaseUri(uri: Uri): Uri | undefined {
        for (const [base, remappedBase] of this.baseRemapping.entries()) {
            const uriText: string = uri.toString(true);
            if (uriText.indexOf(base) === 0) {
                const newpath: string = uriText.replace(base, remappedBase);
                const mappedUri: Uri = Uri.parse(newpath);
                if (this.isLocalFile(mappedUri, Utilities.getFsPathWithFragment(uri))) {
                    return mappedUri;
                }
            }
        }

        return undefined;
    }

    /**
     * Tries to remapped path using any of the RootPaths in the config
     * @param uri file uri to try to rebase
     */
    private tryConfigRootPathsUri(uri: Uri, uriBase?: string): Uri | undefined {
        const originPath: path.ParsedPath = path.parse(Utilities.getFsPathWithFragment(uri));
        const dir: string = originPath.dir.replace(originPath.root, '');

        for (const rootpath of this.rootPaths) {
            const dirParts: string[] = dir.split(path.sep);
            dirParts.push(originPath.base);

            while (dirParts.length !== 0) {
                const mappedUri: Uri = Uri.file(Utilities.joinPath(rootpath, dirParts.join(path.sep)));
                if (this.isLocalFile(mappedUri, Utilities.getFsPathWithFragment(uri))) {
                    this.saveBasePath(uri, mappedUri, uriBase);
                    return mappedUri;
                }

                dirParts.shift();
            }
        }

        return undefined;
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

            if (this.rootPaths.sort().toString() !== newRootPaths.sort().toString()) {
                this.rootPaths = newRootPaths;
                this.updateMappingsWithRootPaths();
            }
        }
    }

    /**
     * Goes through the filemappings and tries to remap any that aren't mapped(null) using the rootpaths
     */
    private updateMappingsWithRootPaths(): void {
        this.fileRemapping.forEach((value: Uri | undefined, key: string, map: Map<string, Uri | undefined>) => {
            this.tryConfigRootPathsUri(Uri.file(key), undefined);
        });
    }

    private async mapFileCommand(location: Location): Promise<Uri | undefined>  {
        return location.mapLocationToLocalPath({ promptUser: true });
    }

    public static uriMappedForLocation(this: Location): Event<Location> {
        const fileMapperInstance: FileMapper = FileMapper.InitializeFileMapper();

        const locationEventEmitter: EventEmitter<Location> | undefined = fileMapperInstance.locationMappedEventEmitterMap.get(this);
        if (locationEventEmitter) {
            return locationEventEmitter.event;
        }

        const newLocationEventEmitter: EventEmitter<Location> = new EventEmitter<Location>();
        FileMapper.fileMapperInstance.disposables.push(newLocationEventEmitter);
        FileMapper.fileMapperInstance.locationMappedEventEmitterMap.set(this, newLocationEventEmitter);

        return newLocationEventEmitter.event;
    }

    /**
     * Attempts to map a location to a local path.
     * @param this The location to be mapped.
     * @param options Options that specify whether the user should be prompted during mapping.
     */
    public static async mapLocationToLocalPath(this: Location, options: MapLocationToLocalPathOptions): Promise<Uri | undefined> {
        const fileMapperInstance: FileMapper = FileMapper.InitializeFileMapper();

        // If the path is already local, then return.
        if (this.mappedToLocalPath) {
            return this.uri;
        }

        // If the location is undefined, there isn't anything we can remap.
        if (!this.uri) {
            return undefined;
        }

        // Let's try to remap.
        const mappedUri: Uri | undefined =  await fileMapperInstance.map(this.uri, this.uriBase, options);
        if (mappedUri) {
            // If successful, save the remapped URI so we don't remap again.
            this.uri = mappedUri;
            this.mappedToLocalPath = true;

            // Let everyone know that the location's URI has changed.
            const locationEventEmitter: EventEmitter<Location> | undefined = fileMapperInstance.locationMappedEventEmitterMap.get(this);
            if (locationEventEmitter) {
                locationEventEmitter.fire(this);
            }
        }

        return mappedUri;
    }

    /**
     * Initialize the file-mapper singleton.
     */
    public static InitializeFileMapper(): FileMapper {
        if (!FileMapper.fileMapperInstance) {
            FileMapper.fileMapperInstance = new FileMapper();
        }

        return FileMapper.fileMapperInstance;
    }
}
