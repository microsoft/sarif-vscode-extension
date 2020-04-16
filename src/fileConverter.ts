/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import * as vscode from "vscode";
import { SarifVersion } from "./common/interfaces";
import { Utilities } from "./utilities";
import { ChildProcess, spawn } from "child_process";
import multitoolPath from "@microsoft/sarif-multitool";

import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface UpgradeCheckInformation {
    /**
     * Contains th the "version" property in the SARIF Json parsed into the SarifVersion interface.
     */
    parsedVersion?: SarifVersion;

    /**
     * Contains th the "$schema" property in the SARIF Json parsed into the SarifVersion object.
     */
    parsedSchemaVersion?: SarifVersion;

    /**
     * The result of the upgrade check.
     */
    upgradedNeeded:
    /** An upgrade is needed */
    'Yes' |
    /** No upgrade is needed */
    'No' |
    /** The schema was not defined */
    'Schema Undefined' |
    /** Could not parse the schema */
    'Could Not Parse Schema' |
    /** There is an issue with schema parsing. */
    'Schema Unknown';
}

/**
 * Options used during upgrade of SARIF to later schema version.
 */
export interface UpgradeSarifOptions {
    /**
     * Indicates whether or not to prompt the user. If prompt user is 'no' a temp file will be created.
     */
    promptUserForUpgrade: boolean;
}

/**
 * Handles converting a non sarif static analysis file to a sarif file via the sarif-sdk multitool
 */
export class FileConverter {
    public static initialize(extensionContext: vscode.ExtensionContext): void {
        FileConverter.registerCommands(extensionContext);
    }

    private static registerCommands(extensionContext: vscode.ExtensionContext): void {
        extensionContext.subscriptions.push(
            vscode.commands.registerCommand('extension.sarif.Convert', FileConverter.selectConverter),
        );
    }

    /**
     * Opens a quick pick list to select a tool, then opens a file picker to select the file and converts selected file
     */
    public static async selectConverter(): Promise<void> {
        interface ToolQuickPickItem extends vscode.QuickPickItem {
            readonly extensions: string[];
            readonly toolKey: string;
        }

        // This really should have a friendly UI name as well as the extension list.
        // We can leave that for another day.
        const fileConverterTools: { [toolNameForMultiTool: string]: { extensions: string[]; name: string } } = {
            AndroidStudio: { extensions: ['xml'], name: localize("converterTool.AndroidStudio", "Android Studio") },
            ClangAnalyzer: { extensions: ['xml'], name: localize("converterTool.ClangAnalyzer", "CLang Analyzer") },
            CppCheck: { extensions: ['xml'], name: localize("converterTool.CppCheck", "CppCheck") },
            ContrastSecurity: { extensions: ['xml'], name: localize("converterTool.ContrastSecurity", "Contrast Security") },
            Fortify: { extensions: ['plist', 'xml'], name: localize("converterTool.Fortify", "Fortify") },
            FortifyFpr: { extensions: ['fpr'], name: localize("converterTool.FortifyFpr", "Fortify Fpr") },
            FxCop: { extensions: ['fxcop', 'xml'], name: localize("converterTool.FxCop", "FxCop") },
            PREfast: { extensions: ['xml'], name: localize("converterTool.PREfast", "PREfast") },
            Pylint: { extensions: ['json'], name: localize("converterTool.Pylint", "Pylint") },
            SemmleQL: { extensions: ['csv'], name: localize("converterTool.SemmleQL", "Semmle QL") },
            StaticDriverVerifier: { extensions: ['tt'], name: localize("converterTool.StaticDriverVerifier", "Static Driver Verifier") },
            TSLint: { extensions: ['json'], name: localize("converterTool.TSLint", "TSLint") }
        };

        const quickPickItems: ToolQuickPickItem[] = [];
        for (const toolNameKey of Object.keys(fileConverterTools)) {
            quickPickItems.push({
                label: fileConverterTools[toolNameKey].name,
                extensions: fileConverterTools[toolNameKey].extensions,
                toolKey: toolNameKey
            });
        }

        const tool: ToolQuickPickItem | undefined = await vscode.window.showQuickPick(quickPickItems);
        if (!tool) {
            return;
        }

        const toolName: string = localize('converterTool.OpenFileDialogTitle', "{0} log files", tool.label);
        const filters: { [name: string]: string[] } = {};
        filters[toolName] = tool.extensions; // We want this to display first and by default.
        filters[localize('converterTool.AllFiles', "All files")] = ['*'];

        const openUris: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters
        });

        if (!openUris || openUris.length !== 1) {
            return;
        }

        FileConverter.convert(openUris[0], tool.toolKey);
    }

    /**
     * Determines if a SARIF file can be upgraded.
     * @param sarifLog The sarif log read in from the log-reader.
     */
    public static sarifLogNeedsUpgrade(sarifLog: sarif.Log): UpgradeCheckInformation {
        const mTCurVersion: SarifVersion = FileConverter.MultiToolCurrentVersion;
        // This is parsing the "version" property from the SARIF json log file
        // I.e.
        // {
        //   "version": "2.0.0",
        //
        const parsedVersion: SarifVersion = FileConverter.parseVersion(sarifLog.version);

        // If the SARIF log has the same version as the multi-tool version, then there is nothing to convert.
        // The version here is not the version off the schema string, it is just the version
        // property in the SARIF JSON.
        // (Assuming of course that the multi-tool is kept in sync with the SARIF npm package this extension relies on).
        // We need to open an issue on this as the @types/sarif version and the multi-tool version can stray apart because
        // the multi-tool code package has no exports to say what version of the schema it is on.
        if (parsedVersion.original === mTCurVersion.original) {
            return {
                upgradedNeeded: 'No',
                parsedVersion
            };
        }

        if (!sarifLog.$schema) {
            return {
                upgradedNeeded: 'Schema Undefined',
                parsedVersion
            };
        }

        let schemaUri: vscode.Uri;
        try {
            schemaUri = vscode.Uri.parse(sarifLog.$schema, /*strict*/ true);
        } catch {
            return {
                upgradedNeeded: 'Could Not Parse Schema',
                parsedVersion
            };
        }

        // This is parsing the "$schema" property from the SARIF json.
        // I.e.
        // {
        //   "$schema": "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json",
        //
        const parsedSchemaVersion: SarifVersion | undefined = FileConverter.parseSchema(schemaUri);
        if (!parsedSchemaVersion) {
            return {
                upgradedNeeded: 'Could Not Parse Schema',
                parsedVersion
            };
        }

        if (!schemaUri.scheme.invariantEqual('http')) {
            return {
                upgradedNeeded: 'Schema Unknown',
                parsedSchemaVersion,
                parsedVersion
            };
        }

        if (schemaUri.authority !== 'json.schemastore.org' &&
            schemaUri.authority !== 'schemastore.azurewebsites.net') {
                return {
                    upgradedNeeded: 'Schema Unknown',
                    parsedSchemaVersion,
                    parsedVersion
                };
        }

        if (!schemaUri.path.startsWith('/sarif-') &&
            !schemaUri.path.startsWith('/schemas/json/sarif-')) {
            return {
                upgradedNeeded: 'Schema Unknown',
                parsedSchemaVersion,
                parsedVersion
            };
        }

        const mTCurSchemaVersion: SarifVersion = FileConverter.MultiToolCurrentSchemaVersion;

        return {
            upgradedNeeded: (parsedSchemaVersion.original !== mTCurSchemaVersion.original) && FileConverter.isOlderThenVersion(parsedSchemaVersion, FileConverter.MultiToolCurrentSchemaVersion) ? 'Yes' : 'No',
            parsedSchemaVersion,
            parsedVersion
        };
    }

    /**
     * Upgrades the sarif file, allows the user to choose to save temp or choose a file location
     * If it's able upgrade then it will close the current file and open the new file
     * Displays a message to the user about the upgrade
     * @param sarifFile the text document of the sarif file to convert
     * @param sarifVersion version of the sarif log
     * @param sarifSchemaVersion version of the sarif logs schema
     * @param options Indicates whether or not to prompt the user. If prompt user is 'no' a temp file will be created.
     */
    public static async upgradeSarif(sarifFile: vscode.Uri, sarifVersion: SarifVersion | undefined, sarifSchemaVersion: SarifVersion | undefined, options: UpgradeSarifOptions): Promise<vscode.Uri | undefined> {

        const saveTempChoice: vscode.MessageItem = {
            title: localize('converterTool.Upgrade.SaveTemp', "Yes (Save Temp)")
        };

        const saveAsChoice: vscode.MessageItem = {
            title: localize('converterTool.Upgrade.SaveAs', "Yes (Save As)")
        };

        const noChoice: vscode.MessageItem = {
            title: localize('converterTool.Upgrade.No', "No")
        };

        let choice: vscode.MessageItem | undefined;

        if (options.promptUserForUpgrade) {
            let upgradeMessage: string;

            if (sarifSchemaVersion) {
                upgradeMessage = localize('converterTool.Upgrade.AskWithSchema', "Sarif schema version {0} is not supported. Upgrade to the latest schema version {1}?", sarifSchemaVersion.original, FileConverter.MultiToolCurrentSchemaVersion.original);
            } else {
                upgradeMessage = localize('converterTool.Upgrade.AskWithVersion', "Sarif version {0} is not supported. Upgrade to the latest version {1}?",
                    sarifVersion && sarifVersion.original ? sarifVersion.original : localize('converterTool.Upgrade.UnknownVersion', "Unknown"), FileConverter.MultiToolCurrentSchemaVersion.original);
            }

            choice = await vscode.window.showInformationMessage(
                upgradeMessage,
                { modal: false },
                saveTempChoice, saveAsChoice, noChoice);

            if (!choice || choice === noChoice) {
                return undefined;
            }
        } else {
            choice = saveTempChoice;
        }

        let output: string | undefined;
        switch (choice) {
            case saveTempChoice:
                output = Utilities.generateTempPath(sarifFile.fsPath);
                break;

            case saveAsChoice:
                const selectedUri: vscode.Uri | undefined = await vscode.window.showSaveDialog({
                    defaultUri: sarifFile,
                    filters: { sarif: ['sarif'] }
                });

                if (selectedUri) {
                    output = selectedUri.fsPath;
                }
                break;
        }

        if (!output) {
            return undefined;
        }

        const fileOutputPath: string = output;
        const errorData: string[] = [];
        const converted: boolean = await new Promise<boolean>((resolve) => {
            // If you are tempted to put quotes around these strings, please don't as "spawn" does that internally.
            // Something to consider is adding an option to the SARIF viewer so the path to the multi-tool
            // can be over-ridden for testing.
            const proc: ChildProcess = spawn(FileConverter.multiToolPath, ['transform', sarifFile.fsPath, '-o', fileOutputPath, '-p', '-f']);

            proc.stderr?.on('data', (data) => {
                errorData.push(data.toString());
            });

            proc.stdout?.on('data', (data) => {
                errorData.push(data.toString());
            });

            proc.on('close', (code) => {
                resolve(code === 0);
            });
        });

        if (!converted) {
            await vscode.window.showErrorMessage(localize('converterTool.Upgrade.FailedMessage', "Sarif upgrade failed with error:{0}", errorData.join('\n')), { modal: false });
            return undefined;
        }

        return vscode.Uri.file(output);
    }

    private static multiToolSchemaVersion: SarifVersion | undefined;
    private static multiToolRawSchema = vscode.Uri.parse('https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json', /*strict*/ true);
    private static multiToolVersion: SarifVersion | undefined;
    private static multiToolRawVersion: sarif.Log.version = '2.1.0';
    private static regExpVersion = /\d+\.\d+\.\d+-?(.+)?/;

    private static get MultiToolCurrentSchemaVersion(): SarifVersion {
        if (!FileConverter.multiToolSchemaVersion) {
            FileConverter.multiToolSchemaVersion = FileConverter.parseSchema(FileConverter.multiToolRawSchema);
        }

        if (!FileConverter.multiToolSchemaVersion) {
            throw new Error('Expected to be able to parse the multi-tool schema.');
        }

        return FileConverter.multiToolSchemaVersion;
    }

    private static get MultiToolCurrentVersion(): SarifVersion {
        if (!FileConverter.multiToolVersion) {
            FileConverter.multiToolVersion = FileConverter.parseVersion(FileConverter.multiToolRawVersion);
        }

        return FileConverter.multiToolVersion;
    }

    /**
     * Converts a file generated by a tool to a sarif file format using the sarif sdk multitool
     * @param uri path to the file to convert
     * @param tool tool that generated the file to convert
     */
    private static convert(uri: vscode.Uri, tool: string): void {
        const output: string = `${Utilities.generateTempPath(uri.fsPath)}.sarif`;
        const proc: ChildProcess = spawn(FileConverter.multiToolPath,
            ['convert', '-t', tool, '-o', output, '-p', '-f', uri.fsPath],
        );

        proc.on('close', async (code) => {
            if (code === 0) {
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(output),
                    { preserveFocus: false, preview: false, viewColumn: vscode.ViewColumn.One });
            } else {
                await vscode.window.showErrorMessage(`Sarif converter failed with error code: ${code} `,
                    { modal: false });
            }
        });
    }

    /**
     * Compares the version to the current to determine if it is older and can be upgraded to current
     * @param version version to compare against the current version
     */
    private static isOlderThenVersion(parsedVer: SarifVersion, currentVer: SarifVersion): boolean {
        let olderThanCurrent: boolean = false;

        if (parsedVer.major < currentVer.major) {
            olderThanCurrent = true;
        } else if (parsedVer.major === currentVer.major) {
            if (parsedVer.minor < currentVer.minor) {
                olderThanCurrent = true;
            } else if (parsedVer.minor === currentVer.minor) {
                if (parsedVer.sub < currentVer.sub) {
                    olderThanCurrent = true;
                } else if (parsedVer.sub === currentVer.sub) {
                    if (currentVer.rtm !== undefined) {
                        if (!parsedVer.rtm) {
                            olderThanCurrent = true;
                        } else if (parsedVer.rtm < currentVer.rtm) {
                            olderThanCurrent = true;
                        }
                    } else if (!currentVer.rtm && !currentVer.csd) {
                        if (parsedVer.csd) {
                            olderThanCurrent = true;
                        }
                    } else if (parsedVer.csd && currentVer.csd) {
                        if (parsedVer.csd < currentVer.csd) {
                            olderThanCurrent = true;
                        } else if (parsedVer.csd === currentVer.csd) {
                            if (parsedVer.csdDate && currentVer.csdDate) {
                                if (parsedVer.csdDate < currentVer.csdDate || !parsedVer.csdDate) {
                                    olderThanCurrent = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        return olderThanCurrent;
    }

    /**
     * Parses the version out to a Version object
     * Current version format: "[Major].[minor].[sub]-csd.[csd].beta.YYYY-MM-DD"
     * ex. "2.0.0-csd.2.beta.2018-10-10"
     * @param version version from the sarif log to parse
     */
    private static parseVersion(version: string): SarifVersion {
        const splitVer: string[] = version.split('.');

        const sarifVersion: SarifVersion = {
            major: parseInt(splitVer[0], 10),
            minor: parseInt(splitVer[1], 10),
            sub: parseInt(splitVer[1], 10),
            original: version.toString()
        };

        if (splitVer[2].indexOf('-csd') !== -1) {
            const splitSub: string[] = splitVer[2].split('-');
            sarifVersion.sub = parseInt(splitSub[0], 10);
            sarifVersion.csd = parseInt(splitVer[3], 10);
            const splitDate: string[] = splitVer[5].split('-');
            sarifVersion.csdDate = new Date(parseInt(splitDate[0], 10), parseInt(splitDate[1], 10),
                parseInt(splitDate[2], 10));
        } else if (splitVer[2].indexOf('-rtm') !== -1) {
            const splitSub: string[] = splitVer[2].split('-');
            sarifVersion.sub = parseInt(splitSub[0], 10);
            sarifVersion.rtm = parseInt(splitVer[3], 10);
        } else {
            sarifVersion.sub = parseInt(splitVer[2], 10);
        }

        return sarifVersion;
    }

    /**
     * Parses the version out of the schema string to a Version object
     * ex. "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json"
     * @param schema schema string from the sarif log to parse
     */
    private static parseSchema(schema: vscode.Uri): SarifVersion | undefined {
        const regEx: RegExp = new RegExp(FileConverter.regExpVersion);
        const matchArray: RegExpExecArray | null = regEx.exec(schema.path);
        if (!matchArray || matchArray.length === 0) {
            return undefined;
        }

        // The lower-case JSON is okay here because it is part of the schema URI
        // which IS case sensitive.
        const rawSchemaVersion: string = matchArray[0].replace('.json', '');

        return FileConverter.parseVersion(rawSchemaVersion);
    }

    /**
     * Returns the path to the multi-tool.
     * The path can be overridden by setting 'sarifViewer.multiToolPath'
     * in the process environment.
     */
    private static get multiToolPath(): string {
        return process.env['sarifViewer.multiToolPath'] || multitoolPath;
    }
}
