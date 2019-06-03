// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    commands, extensions, MessageOptions, OpenDialogOptions, SaveDialogOptions, TextDocument, TextDocumentShowOptions,
    Uri, ViewColumn, window,
} from "vscode";
import { SarifVersion } from "./common/Interfaces";
import { Utilities } from "./Utilities";

/**
 * Handles converting a non sarif static analysis file to a sarif file via the sarif-sdk multitool
 */
export class FileConverter {
    public static ConvertCommand = "extension.sarif.Convert";

    /**
     * Opens a quick pick list to select a tool, then opens a file picker to select the file and converts selected file
     */
    public static selectConverter() {
        let tool: string;
        window.showQuickPick(Array.from(FileConverter.Tools.keys())).then((value: string) => {
            if (value === undefined) {
                return;
            }

            tool = value;
            const dialogOptions = { canSelectFiles: true, canSelectMany: false, filters: {} } as OpenDialogOptions;
            const toolExt = FileConverter.Tools.get(tool);
            dialogOptions.filters[`${tool} log files`] = toolExt;

            return window.showOpenDialog(dialogOptions);
        }).then((uris: Uri[]) => {
            if (uris !== undefined && uris.length > 0) {
                FileConverter.convert(uris[0], tool);
            }
        });
    }

    /**
     * Checks if the Version and Schema version are older then the current version and tries to upgrade if they are
     * Returns false if Version and Schema Version match and the file can be loaded the way it is
     * @param version The version from the sarif file
     * @param schema The Schema from the sarif file
     * @param doc the text document of the sarif file to convert
     */
    public static tryUpgradeSarif(version: sarif.Log.version, schema: string, doc: TextDocument): boolean {
        let tryToUpgrade = false;
        const curVersion = FileConverter.CurrentVersion;
        const parsedVer = FileConverter.parseVersion(version);
        let parsedSchemaVer: SarifVersion;

        if (parsedVer.original !== curVersion.original) {
            tryToUpgrade = FileConverter.isOlderThenVersion(parsedVer, curVersion);
        } else {
            parsedSchemaVer = FileConverter.parseSchema(schema);
            const curSchemaVersion = FileConverter.CurrentSchemaVersion;

            if (parsedSchemaVer.original !== curSchemaVersion.original) {
                tryToUpgrade = FileConverter.isOlderThenVersion(parsedSchemaVer, curSchemaVersion);
            } else {
                return false;
            }
        }

        if (tryToUpgrade) {
            FileConverter.upgradeSarif(doc, parsedVer, parsedSchemaVer);
        } else {
            window.showErrorMessage(`Sarif version '${version}' is not yet supported by the Viewer.
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
    public static async upgradeSarif(doc: TextDocument, sarifVersion?: SarifVersion, sarifSchema?: SarifVersion) {
        const saveTemp = "Yes (Save Temp)";
        const saveAs = "Yes (Save As)";
        const msgOptions = { modal: false } as MessageOptions;
        let curVersion: string;
        let version: string;
        let infoMsg: string;

        if (sarifSchema !== undefined) {
            curVersion = FileConverter.CurrentSchemaVersion.original;
            version = `schema version ${sarifSchema.original}`;
        } else {
            curVersion = FileConverter.CurrentVersion.original;
            version = `version ${sarifVersion.original}`;
        }

        infoMsg = `Sarif '${version}' is not supported. Upgrade to the latest version? '${curVersion}'`;
        const choice = await window.showInformationMessage(infoMsg, msgOptions, saveTemp, saveAs, "No");

        let output: string;
        switch (choice) {
            case saveTemp:
                output = Utilities.generateTempPath(doc.uri.fsPath);
                break;
            case saveAs:
                const saveOptions: SaveDialogOptions = Object.create(null);
                saveOptions.defaultUri = doc.uri;
                saveOptions.filters = { sarif: ["sarif"] };

                await window.showSaveDialog(saveOptions).then((selectedUri) => {
                    if (selectedUri !== undefined) {
                        output = selectedUri.fsPath;
                    }
                });
                break;
        }

        if (output !== undefined) {
            const proc = FileConverter.ChildProcess.spawn(FileConverter.MultiTool,
                ["transform", doc.uri.fsPath, "-o", output, "-p", "-f"],
            );

            let errorData;
            proc.stdout.on("data", (data) => {
                errorData = data.toString();
            });

            proc.on("close", (code) => {
                if (code === 0) {
                    const textEditor = window.activeTextEditor;
                    // try to close the editor
                    if (textEditor !== undefined && textEditor.document.fileName === doc.fileName) {
                        commands.executeCommand("workbench.action.closeActiveEditor");
                    }

                    commands.executeCommand("vscode.open", Uri.file(output),
                        {
                            preserveFocus: false, preview: false, viewColumn: ViewColumn.One,
                        } as TextDocumentShowOptions);
                } else {
                    window.showErrorMessage(`Sarif upgrade failed with error:
        ${errorData}`,
                        { modal: false } as MessageOptions);
                }
            });
        }
    }

    private static childProcess;
    private static curSchemaVersion: SarifVersion;
    private static curVersion: SarifVersion;
    private static multiTool: string;
    private static tools: Map<string, string[]>;

    private static get ChildProcess() {
        if (FileConverter.childProcess === undefined) {
            FileConverter.childProcess = require("child_process");
        }

        return FileConverter.childProcess;
    }

    private static get CurrentSchemaVersion() {
        if (FileConverter.curSchemaVersion === undefined) {
            FileConverter.curSchemaVersion = FileConverter.parseSchema("http://json.schemastore.org/sarif-2.1.0-rtm.1");
        }

        return FileConverter.curSchemaVersion;
    }

    private static get CurrentVersion() {
        if (FileConverter.curVersion === undefined) {
            FileConverter.curVersion = FileConverter.parseVersion("2.1.0");
        }

        return FileConverter.curVersion;
    }

    private static get MultiTool(): string {
        if (FileConverter.multiTool === undefined) {
            FileConverter.multiTool = extensions.getExtension("MS-SarifVSCode.sarif-viewer").extensionPath +
                "/resources/sarif.multitool/Sarif.Multitool.exe";
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
    private static convert(uri: Uri, tool: string) {
        const output = Utilities.generateTempPath(uri.fsPath) + ".sarif";
        const proc = FileConverter.ChildProcess.spawn(FileConverter.MultiTool,
            ["convert", "-t", tool, "-o", output, "-p", "-f", uri.fsPath],
        );

        proc.on("close", (code) => {
            if (code === 0) {
                commands.executeCommand("vscode.open", Uri.file(output),
                    { preserveFocus: false, preview: false, viewColumn: ViewColumn.One } as TextDocumentShowOptions);
            } else {
                window.showErrorMessage(`Sarif converter failed with error code: ${code} `,
                    { modal: false } as MessageOptions);
            }
        });
    }

    /**
     * Compares the version to the current to determine if it is older and can be upgraded to current
     * @param version version to compare against the current version
     */
    private static isOlderThenVersion(parsedVer: SarifVersion, currentVer: SarifVersion): boolean {
        let olderThanCurrent = false;

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
                        if (parsedVer.rtm === undefined) {
                            olderThanCurrent = true;
                        } else if (parsedVer.rtm < currentVer.rtm) {
                            olderThanCurrent = true;
                        }
                    } else if (currentVer.rtm === undefined && currentVer.csd === undefined) {
                        if (parsedVer.csd !== undefined) {
                            olderThanCurrent = true;
                        }
                    } else if (parsedVer.csd !== undefined && currentVer.csd !== undefined) {
                        if (parsedVer.csd < currentVer.csd) {
                            olderThanCurrent = true;
                        } else if (parsedVer.csd === currentVer.csd) {
                            if (parsedVer.csdDate < currentVer.csdDate) {
                                olderThanCurrent = true;
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
    private static parseVersion(version: sarif.Log.version): SarifVersion {
        const parsedVer = {} as SarifVersion;
        const splitVer = version.split(".");
        parsedVer.original = version.toString();
        parsedVer.major = parseInt(splitVer[0], 10);
        parsedVer.minor = parseInt(splitVer[1], 10);
        if (splitVer[2].indexOf("-csd") !== -1) {
            const splitSub = splitVer[2].split("-");
            parsedVer.sub = parseInt(splitSub[0], 10);
            parsedVer.csd = parseInt(splitVer[3], 10);
            const splitDate = splitVer[5].split("-");
            parsedVer.csdDate = new Date(parseInt(splitDate[0], 10), parseInt(splitDate[1], 10),
                parseInt(splitDate[2], 10));
        } else if (splitVer[2].indexOf("-rtm") !== -1) {
            const splitSub = splitVer[2].split("-");
            parsedVer.sub = parseInt(splitSub[0], 10);
            parsedVer.rtm = parseInt(splitVer[3], 10);
        } else {
            parsedVer.sub = parseInt(splitVer[2], 10);
        }

        return parsedVer;
    }

    /**
     * Parses the version out of the schema string to a Version object
     * ex. "http://json.schemastore.org/sarif-2.1.0-rtm.1"
     * @param schema schema string from the sarif log to parse
     */
    private static parseSchema(schema: string): SarifVersion {
        const splitSchema = schema.split("sarif-");
        const schemaVer = FileConverter.parseVersion(splitSchema[splitSchema.length - 1] as sarif.Log.version);
        return schemaVer;
    }

}
