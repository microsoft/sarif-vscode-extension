/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as sarif from "sarif";
import * as vscode from "vscode";
import { SarifVersion } from "./common/Interfaces";
import { Utilities } from "./Utilities";
import { ChildProcess, spawn } from "child_process";

/**
 * Handles converting a non sarif static analysis file to a sarif file via the sarif-sdk multitool
 */
export class FileConverter {
    private static extensionContext: vscode.ExtensionContext | undefined;

    public static initialize(extensionContext: vscode.ExtensionContext): void {
        FileConverter.extensionContext = extensionContext;
        FileConverter.registerCommands(extensionContext);
    }

    private  static registerCommands(extensionContext: vscode.ExtensionContext): void {
        extensionContext.subscriptions.push(
            vscode.commands.registerCommand("extension.sarif.Convert", FileConverter.selectConverter),
        );
    }

    /**
     * Opens a quick pick list to select a tool, then opens a file picker to select the file and converts selected file
     */
    public static async selectConverter(): Promise<void> {
        interface ToolQuickPickItem extends vscode.QuickPickItem {
            readonly extensions: string[];
        }

        const quickPickItems: ToolQuickPickItem[] = [];
        for (const [toolName, toolExtensions] of FileConverter.Tools.entries()) {
            quickPickItems.push({
                label: toolName,
                extensions: toolExtensions
            });
        }

        const tool: ToolQuickPickItem | undefined = await vscode.window.showQuickPick(quickPickItems);
        if (!tool) {
            return;
        }

        const toolName: string = `${tool.label} log files`;
        const filters: { [name: string]: string[] } = {};
        filters[toolName] = tool.extensions;

        const openUris: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters: filters
        });

        if (!openUris) {
            return;
        }
        if (openUris.length > 0) {
            FileConverter.convert(openUris[0], tool.label);
        }
    }

    /**
     * Checks if the Version and Schema version are older then the MultiTools current version and upgrades if they are
     * Returns false if Version and Schema Version match and the file can be loaded the way it is
     * @param version The version from the sarif file
     * @param schema The Schema from the sarif file
     * @param doc the text document of the sarif file to convert
     */
    public static async tryUpgradeSarif(version: sarif.Log.version, schema: string, doc: vscode.TextDocument): Promise<boolean> {
        let tryToUpgrade: boolean = false;
        const mTCurVersion: SarifVersion = FileConverter.MultiToolCurrentVersion;
        const parsedVer: SarifVersion = FileConverter.parseVersion(version);
        let parsedSchemaVer: SarifVersion | undefined;

        if (parsedVer.original !== mTCurVersion.original) {
            tryToUpgrade = FileConverter.isOlderThenVersion(parsedVer, mTCurVersion);
        } else {
            if (schema === "http://json.schemastore.org/sarif-2.1.0-rtm.1") {
                // By passes a bug in the multitool, remove after fix https://github.com/microsoft/sarif-sdk/issues/1584
                return false;
            } else if (schema && (schema.startsWith("http://json.schemastore.org/sarif-") ||
                schema.startsWith("https://schemastore.azurewebsites.net/schemas/json/sarif-"))) {
                parsedSchemaVer = FileConverter.parseSchema(schema);

                if (!parsedSchemaVer) {
                    return false;
                }

                const mTCurSchemaVersion: SarifVersion = FileConverter.MultiToolCurrentSchemaVersion;

                if (parsedSchemaVer.original !== mTCurSchemaVersion.original) {
                    tryToUpgrade = FileConverter.isOlderThenVersion(parsedSchemaVer, mTCurSchemaVersion);
                } else {
                    return false;
                }
            } else {
                return false;
            }
        }

        if (tryToUpgrade) {
            await FileConverter.upgradeSarif(doc, parsedVer, parsedSchemaVer);
        } else {
            await vscode.window.showErrorMessage(`Sarif version '${version}'(schema '${schema}') is not yet supported by the Viewer.
            Make sure you have the latest extension version and check
            https://github.com/Microsoft/sarif-vscode-extension for future support.`);
        }

        return true;
    }

    /**
     * Upgrades the sarif file, allows the user to choose to save temp or choose a file location
     * If it's able upgrade then it will close the current file and open the new file
     * Displays a message to the user about the upgrade
     * @param doc the text document of the sarif file to convert
     * @param sarifVersion version of the sarif log
     * @param sarifSchema version of the sarif logs schema
     */
    public static async upgradeSarif(doc: vscode.TextDocument, sarifVersion?: SarifVersion, sarifSchema?: SarifVersion): Promise<void> {
        interface UpgradeChoiceMessageItem extends vscode.MessageItem {
            choice: 'Temp' | 'Save As' | 'No';
        }

        const saveTempChoice: UpgradeChoiceMessageItem =  {
            choice: 'Temp',
            title: "Yes (Save Temp)"
        };

        const saveAsChoice: UpgradeChoiceMessageItem = {
            choice: 'Save As',
            title: "Yes (Save As)"
        };

        const noChoice: UpgradeChoiceMessageItem = {
            choice: 'No',
            title: "No"
        };

        let curVersion: string;
        let version: string;

        if (sarifSchema) {
            curVersion = `schema version '${FileConverter.MultiToolCurrentSchemaVersion.original}'`;
            version = `schema version '${sarifSchema.original}'`;
        } else {
            curVersion = `version '${FileConverter.MultiToolCurrentVersion.original}'`;
            version = `version '${sarifVersion && sarifVersion.original ? sarifVersion.original : "Unknown"}'`;
        }

        const choice: UpgradeChoiceMessageItem | undefined = await vscode.window.showInformationMessage(
            `Sarif ${version} is not supported. Upgrade to the latest ${curVersion}?`,
            { modal: false },
            saveTempChoice, saveAsChoice, noChoice);

        if (!choice || choice === noChoice) {
            return;
        }

        let output: string | undefined;
        switch (choice) {
            case saveTempChoice:
                output = Utilities.generateTempPath(doc.uri.fsPath);
                break;

            case saveAsChoice:
                const selectedUri: vscode.Uri | undefined = await vscode.window.showSaveDialog({
                    defaultUri: doc.uri,
                    filters: { sarif: ["sarif"] }
                });

                if (selectedUri) {
                    output = selectedUri.fsPath;
                }
                break;
        }

        if (!output) {
            return;
        }

        const proc: ChildProcess = spawn(FileConverter.MultiToolExecutablePath,
            ["transform", doc.uri.fsPath, "-o", output, "-p", "-f"],
        );

        const errorData: string[] = [];
        proc.stdout.on("data", (data) => {
            errorData.push(data.toString());
        });

        proc.on("close", async (code) => {
            if (code === 0) {
                if (!output) {
                    return;
                }

                const textEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
                // try to close the editor
                if (textEditor && textEditor.document.fileName === doc.fileName) {
                    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                }

                await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(output), {
                        preserveFocus: false,
                        preview: false,
                        viewColumn: vscode.ViewColumn.One,
                });
            } else {
                await vscode.window.showErrorMessage(`Sarif upgrade failed with error: ${errorData.join('\n')}`, { modal: false });
            }
        });
    }

    private static multiToolSchemaVersion: SarifVersion | undefined;
    private static multiToolRawSchema = "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json";
    private static multiToolVersion: SarifVersion | undefined;
    private static multiToolRawVersion: sarif.Log.version = "2.1.0";
    private static multiTool: string;
    private static tools: Map<string, string[]>;
    private static regExpVersion = /\d+\.\d+\.\d+-?(.+)?/;

    private static get MultiToolCurrentSchemaVersion(): SarifVersion {
        if (!FileConverter.multiToolSchemaVersion) {
            FileConverter.multiToolSchemaVersion = FileConverter.parseSchema(FileConverter.multiToolRawSchema);
        }

        if (!FileConverter.multiToolSchemaVersion) {
            throw new Error("Expected to be able to parse the multi-tool schema.");
        }

        return FileConverter.multiToolSchemaVersion;
    }

    private static get MultiToolCurrentVersion(): SarifVersion {
        if (!FileConverter.multiToolVersion) {
            FileConverter.multiToolVersion = FileConverter.parseVersion(FileConverter.multiToolRawVersion);
        }

        return FileConverter.multiToolVersion;
    }

    private static get MultiToolExecutablePath(): string {
        if (!FileConverter.extensionContext) {
            throw new Error("File converter properties were not properly initialized.");
        }

        if (!FileConverter.multiTool) {
            FileConverter.multiTool = FileConverter.extensionContext.asAbsolutePath("/resources/sarif.multitool/Sarif.Multitool.exe");
        }

        return FileConverter.multiTool;
    }

    private static get Tools(): Map<string, string[]> {
        if (FileConverter.tools === undefined) {
            FileConverter.tools = new Map<string, string[]>();
            FileConverter.tools.set("AndroidStudio", ["xml"]);
            FileConverter.tools.set("ClangAnalyzer", ["xml"]);
            FileConverter.tools.set("CppCheck", ["xml"]);
            FileConverter.tools.set("ContrastSecurity", ["xml"]);
            FileConverter.tools.set("Fortify", ["xml"]);
            FileConverter.tools.set("FortifyFpr", ["fpr"]);
            FileConverter.tools.set("FxCop", ["fxcop", "xml"]);
            FileConverter.tools.set("PREfast", ["xml"]);
            FileConverter.tools.set("Pylint", ["json"]);
            FileConverter.tools.set("SemmleQL", ["csv"]);
            FileConverter.tools.set("StaticDriverVerifier", ["tt"]);
            FileConverter.tools.set("TSLint", ["json"]);
        }

        return FileConverter.tools;
    }

    /**
     * Converts a file generated by a tool to a sarif file format using the sarif sdk multitool
     * @param uri path to the file to convert
     * @param tool tool that generated the file to convert
     */
    private static convert(uri: vscode.Uri, tool: string): void {
        const output: string = Utilities.generateTempPath(uri.fsPath) + ".sarif";
        const proc: ChildProcess = spawn(FileConverter.MultiToolExecutablePath,
            ["convert", "-t", tool, "-o", output, "-p", "-f", uri.fsPath],
        );

        proc.on("close", async (code) => {
            if (code === 0) {
                await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(output),
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
        const splitVer: string[] = version.split(".");

        const sarifVersion: SarifVersion = {
            major: parseInt(splitVer[0], 10),
            minor: parseInt(splitVer[1], 10),
            sub: parseInt(splitVer[1], 10),
            original: version.toString()
        };

        if (splitVer[2].indexOf("-csd") !== -1) {
            const splitSub: string[] = splitVer[2].split("-");
            sarifVersion.sub = parseInt(splitSub[0], 10);
            sarifVersion.csd = parseInt(splitVer[3], 10);
            const splitDate: string[] = splitVer[5].split("-");
            sarifVersion.csdDate = new Date(parseInt(splitDate[0], 10), parseInt(splitDate[1], 10),
                parseInt(splitDate[2], 10));
        } else if (splitVer[2].indexOf("-rtm") !== -1) {
            const splitSub: string[] = splitVer[2].split("-");
            sarifVersion.sub = parseInt(splitSub[0], 10);
            sarifVersion.rtm = parseInt(splitVer[3], 10);
        } else {
            sarifVersion.sub = parseInt(splitVer[2], 10);
        }

        return sarifVersion;
    }

    /**
     * Parses the version out of the schema string to a Version object
     * ex. "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.4.json"
     * @param schema schema string from the sarif log to parse
     */
    private static parseSchema(schema: string): SarifVersion | undefined {
        const regEx: RegExp = new RegExp(FileConverter.regExpVersion);
        const matchArray: RegExpExecArray | null  = regEx.exec(schema);
        if (!matchArray || matchArray.length === 0) {
            return undefined;
        }

        const rawSchemaVersion: string = matchArray[0].replace(".json", "");

        return FileConverter.parseVersion(rawSchemaVersion);
    }
}
