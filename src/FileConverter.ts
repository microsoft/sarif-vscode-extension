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
     * Upgrades the sarif file, allows the user to choose to save temp or choose a file location
     * If it's able upgrade then it will close the current file and open the new file
     * Displays a message to the user about the upgrade
     * @param version version of the sarif log
     * @param doc the text document of the sarif file to convert
     */
    public static async upgradeSarif(version: sarif.Log.version, doc: TextDocument) {
        if (FileConverter.canUpgradeVersion(version) === true) {
            const saveTemp = "Yes (Save Temp)";
            const saveAs = "Yes (Save As)";
            const supportedVersion: sarif.Log.version = "2.0.0-csd.2.beta.2019-01-09";
            const choice = await window.showInformationMessage(`Sarif version '${version}' is not supported.
            Upgrade to the latest version? '${supportedVersion}'`,
                { modal: false } as MessageOptions, saveTemp, saveAs, "No");

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
                        if (window.activeTextEditor.document.fileName === doc.fileName) {
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
        } else {
            window.showErrorMessage(`Sarif version '${version}' is not yet supported by the Viewer.
            Make sure you have the latest extension version and check
            https://github.com/Microsoft/sarif-vscode-extension for future support.`);
        }
    }

    private static childProcess;
    private static curVersion: SarifVersion;
    private static multiTool: string;
    private static tools: Map<string, string[]>;

    private static get ChildProcess() {
        if (FileConverter.childProcess === undefined) {
            FileConverter.childProcess = require("child_process");
        }

        return FileConverter.childProcess;
    }

    private static get CurrentVersion() {
        if (FileConverter.curVersion === undefined) {
            FileConverter.curVersion = FileConverter.parseVersion("2.0.0-csd.2.beta.2019-01-09");
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
                window.showErrorMessage(`Sarif converter failed with error code: ${code}`,
                    { modal: false } as MessageOptions);
            }
        });
    }

    /**
     * Compares the version to the current to determine if it is older and can be upgraded to current
     * @param version version to compare against the current version
     */
    private static canUpgradeVersion(version: sarif.Log.version): boolean {
        const parsedVer = FileConverter.parseVersion(version);
        const currentVer = FileConverter.CurrentVersion;
        let canUpgrade = false;
        if (parsedVer.major < currentVer.major) {
            canUpgrade = true;
        } else if (parsedVer.major === currentVer.major) {
            if (parsedVer.minor < currentVer.minor) {
                canUpgrade = true;
            } else if (parsedVer.minor === currentVer.minor) {
                if (parsedVer.sub < currentVer.sub) {
                    canUpgrade = true;
                } else if (parsedVer.sub === currentVer.sub && this.curVersion.csd !== undefined) {
                    if (parsedVer.csd === undefined) {
                        canUpgrade = true;
                    } else if (parsedVer.csd < currentVer.csd) {
                        canUpgrade = true;
                    } else if (parsedVer.csd === currentVer.csd) {
                        if (parsedVer.csdDate < currentVer.csdDate) {
                            canUpgrade = true;
                        }
                    }
                }
            }
        }

        return canUpgrade;
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

        parsedVer.major = parseInt(splitVer[0], 10);
        parsedVer.minor = parseInt(splitVer[1], 10);
        if (splitVer[2].indexOf("-csd") === -1) {
            parsedVer.sub = parseInt(splitVer[2], 10);
        } else {
            const splitSub = splitVer[2].split("-");
            parsedVer.sub = parseInt(splitSub[0], 10);
            parsedVer.csd = parseInt(splitVer[3], 10);
            const splitDate = splitVer[5].split("-");
            parsedVer.csdDate = new Date(parseInt(splitDate[0], 10), parseInt(splitDate[1], 10),
                parseInt(splitDate[2], 10));
        }

        return parsedVer;
    }

}
