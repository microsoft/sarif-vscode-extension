// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    Disposable, Event, EventEmitter, ExtensionContext, TextDocumentContentProvider, Uri, window, workspace,
} from "vscode";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { ResultLocation } from "./ResultLocation";
import { SVDiagnostic } from "./SVDiagnostic";

/**
 * This class handles generating and providing the HTML content for the Explorer panel
 */
export class ExplorerContentProvider implements TextDocumentContentProvider {
    public static readonly ExplorerUri = Uri.parse("sarifExplorer://authority/sarifExplorer");
    public static readonly ExplorerTitle = "SARIF Explorer";
    public static readonly ExplorerLaunchCommand = "extension.sarif.ExplorerLaunch";
    public static readonly ExplorerCallbackCommand = "extension.sarif.ExplorerCallback";

    private static instance: ExplorerContentProvider;

    public context: ExtensionContext;
    public activeSVDiagnostic: SVDiagnostic;

    private onDidChangeEmitter = new EventEmitter<Uri>();
    private textDocContentProRegistration: Disposable;
    private visibleChangeDisposable: Disposable;

    private constructor() {
        this.textDocContentProRegistration = workspace.registerTextDocumentContentProvider("sarifExplorer", this);
        this.visibleChangeDisposable = window.onDidChangeVisibleTextEditors(
            CodeFlowDecorations.updateLocationsHighlight, this);
    }

    public get onDidChange(): Event<Uri> {
        return this.onDidChangeEmitter.event;
    }

    public static get Instance(): ExplorerContentProvider {
        return ExplorerContentProvider.instance || (ExplorerContentProvider.instance = new ExplorerContentProvider());
    }

    /**
     * For disposing on extension close
     */
    public dispose() {
        this.textDocContentProRegistration.dispose();
        this.visibleChangeDisposable.dispose();
    }

    /**
     * Explorer callback, allows the explorer to call back to the extension with a request
     * @param request request object from the explorer
     */
    public explorerCallback(request: any) {
        switch (request.request) {
            case "treeselectionchange":
                const selectionId = (request.treeid_step as string).split("_");
                if (selectionId.length === 2) {
                    CodeFlowDecorations.updateSelectionHighlight(selectionId[0], selectionId[1]);
                }
                break;
            case "verbositychanged":
                break;
        }
    }

    /**
     * Provide textual content for a given uri. The editor will use the returned string-content to create a readonly
     * document. Resources allocated should be released when the corresponding document has been closed.
     * @param uri An uri which scheme matches the scheme this provider was registered for.
     */
    public provideTextDocumentContent(uri: Uri): string {
        CodeFlowDecorations.updateLocationsHighlight();
        return this.assembleExplorerContent();
    }

    /**
     * Updates the explorer to display the details of the passed SVDiagnostic
     * @param svDiagnostic the new SVDiagnostic the explorer with show
     */
    public update(svDiagnostic: SVDiagnostic) {
        this.activeSVDiagnostic = svDiagnostic;
        this.onDidChangeEmitter.fire(ExplorerContentProvider.ExplorerUri);
    }

    /**
     * Primary function that generates the HTML displayed in the Explorer window
     */
    private assembleExplorerContent(): string {
        if (this.activeSVDiagnostic !== undefined) {
            const cssMarkup = Uri.file(this.context.asAbsolutePath("out/explorer/explorer.css")).toString();
            const scriptPath = Uri.file(this.context.asAbsolutePath("out/explorer/explorer.js")).toString();

            const explorerHeaderContent = this.createExplorerHeaderContent();
            const ruleDescription = this.sanatizeText(this.activeSVDiagnostic.resultInfo.message);
            const resultInfoTabContent = this.createResultInfoTabContent();
            const runInfoTabContent = this.createRunInfoTabContent();
            const codeFlowTabContent = this.createCodeFlowTabContent(this.activeSVDiagnostic.rawResult.codeFlows);

            const tabsContainerContent = this.createTabContainerHeaderContent(codeFlowTabContent !== "");

            let setOpenTab: string;
            if (codeFlowTabContent !== "") {
                setOpenTab = "codeflowtab";
            } else {
                setOpenTab = "resultinfotab";
            }

            return `
            <head>
                <link rel="stylesheet" type="text/css" href="${cssMarkup}" />
            </head>
            <body>
                ${explorerHeaderContent}
                <div id="ruledescription">${ruleDescription}</div>
                ${tabsContainerContent}
                <div id="tabContentContainer">
                    ${resultInfoTabContent}
                    ${codeFlowTabContent}
                    ${runInfoTabContent}
                </div>
            </body>
            <script src=${scriptPath}></script>
            <script>
                openTab("${setOpenTab}");
            </script>
            `;
        } else {
            return `Select an issue in the Problems window`;
        }

    }

    /**
     * Creates the content that shows when the user clicks the Code Flow tab
     */
    private createCodeFlowTabContent(codeFlows: sarif.CodeFlow[]): string {
        let output = "";
        if (codeFlows !== undefined && codeFlows.length > 0) {
            const codeFlowContent = this.createCodeFlowTrees(codeFlows);
            output = `
            <div id="codeflowtabcontent" class="tabcontent">
                <div class="tabcontentheader">
                    <div class="tabcontentheaderbutton" id="expandallcodeflow" title="Expand All">+</div>
                    <div class="tabcontentheaderbutton" id="collapseallcodeflow" title="Collapse All">-</div>
                    <div class="tabcontentheadersperator">|</div>
                    <div>
                        <input id="codeflowverbosity" type="range" max="2" title="Tree Verbosity">
                    </div>
                </div>
                <div id="codeflowtreecontainer">
                    ${codeFlowContent}
                </div>
            </div>`;
        }
        return output;
    }

    /**
     * Generates the html for all of the Code Flows
     * @param codeflows array of code flows that need to be displayed
     */
    private createCodeFlowTrees(codeflows: sarif.CodeFlow[]): string {
        let output = "";

        for (let i = 0; i < codeflows.length; i++) {
            output += `<ul class="codeflowtreeroot">`;
            output += this.createCodeFlowTree(codeflows[i], i);
            output += `</ul><br>`;
        }

        return output;
    }

    /**
     * Generates the Html tree for a Code Flow
     * @param codeflow Code Flow that needs to be converted to a tree
     * @param treeId Id of the tree for later reference
     */
    private createCodeFlowTree(codeflow: sarif.CodeFlow, treeId: number): string {
        let output = "";
        let nestedCount = 0;

        for (let i = 0; i < codeflow.locations.length; i++) {
            const location = codeflow.locations[i];
            let liClass: string;
            let tooltip: string;
            let fileNameAndLine: string;
            let message: string;

            // Set any special values based on the kind
            switch (location.kind) {
                case sarif.AnnotatedCodeLocation.kind.call:
                    liClass = "expanded";
                    break;
                case sarif.AnnotatedCodeLocation.kind.callReturn:
                    message = "Return";
                    fileNameAndLine = " ";
                    break;
                default:
            }

            // Anything that still not defined use the default method of finding the value
            liClass = liClass || "unexpandable";
            tooltip = tooltip || location.kind || "Unknown";
            message = message || location.message || location.target || "";
            fileNameAndLine = fileNameAndLine ||
                `${location.physicalLocation.uri.substring(location.physicalLocation.uri.lastIndexOf("/") + 1)}
                (${location.physicalLocation.region.startLine})`;

            // Add the importance to the class
            liClass += " " + (location.importance || sarif.AnnotatedCodeLocation.importance.important);

            // Add the Verbosity show state to the class
            liClass += " verbosityshow";

            // Sanatize all of the strings before putting in the html string
            liClass = this.sanatizeText(liClass);
            tooltip = this.sanatizeText(tooltip);
            fileNameAndLine = this.sanatizeText(fileNameAndLine);
            message = this.sanatizeText(message);

            // if no message is defined need to set it to space so the element shows up correctly
            if (message === "") {
                message = "&nbsp;";
            }

            // Add the html with values
            output += `<li id="${treeId}_${i}" class="${liClass}" title="${tooltip}" tabindex="0">`;
            output += `<span class="codeflowlocation">${fileNameAndLine}</span>`;
            output += `${message}`;

            if (location.kind === sarif.AnnotatedCodeLocation.kind.call) {
                // if it's a call don't close element, instead open add a child element
                nestedCount++;
                output += `<ul>`;
            } else if (location.kind === sarif.AnnotatedCodeLocation.kind.callReturn) {
                // if it's a callReturn close the child element and call element
                nestedCount--;
                output += `</li>`;
                output += `</ul>`;
                // closes the call element
                output += `</li>`;
            } else {
                // default to closing the element
                output += `</li>`;
            }
        }

        // Clean up incase the codeflow ended inside a method call with no call return.
        while (nestedCount > 0) {
            nestedCount--;
            output += `</ul>`;
            output += `</li>`;
        }

        return output;
    }

    /**
     * Creates the content that shows in the header of the Explorer window
     */
    private createExplorerHeaderContent(): string {
        let filenameandline = this.activeSVDiagnostic.resultInfo.locations[0].fileName + " (" +
            (this.activeSVDiagnostic.resultInfo.locations[0].location.start.line + 1/*Range is 0 based*/) + ")";
        filenameandline = this.sanatizeText(filenameandline);
        const ruleId = this.sanatizeText(this.activeSVDiagnostic.resultInfo.ruleId);
        const ruleName = this.sanatizeText(this.activeSVDiagnostic.resultInfo.ruleName);

        return `
        <div id="title">
            <label id="titleruleid">${ruleId}</label>
            <label id="titlerulename">${ruleName}</label> |
            <label>${filenameandline}</label>
        </div>`;
    }

    /**
     * Creates the Related locations Html in the ResultInfo
     * @param locations Array of ResultLocations to be added to the Html
     */
    private createLocations(locations: ResultLocation[]): string {
        let output = "";

        for (let index = 0; index < locations.length; index++) {
            if (index > 0) {
                output += "<br>";
            }

            output += `<label title="${encodeURI(locations[index].uri.fsPath)}">
            ${this.sanatizeText(locations[index].fileName)}
            (${this.sanatizeInt(locations[index].location.start.line) + 1/*because Range is zero based*/})
            </label>`;
        }

        return output;
    }

    /**
     * Creates the content that shows when the user clicks the resultinfo tab
     */
    private createResultInfoTabContent(): string {
        const ruleId = this.sanatizeText(this.activeSVDiagnostic.resultInfo.ruleId);
        const ruleName = this.sanatizeText(this.activeSVDiagnostic.resultInfo.ruleName);
        const ruleDefaultLevel = this.sanatizeText(this.activeSVDiagnostic.resultInfo.ruleDefaultLevel);
        const ruleHelpUriText = this.sanatizeText(this.activeSVDiagnostic.resultInfo.ruleHelpUri);
        const ruleHelpUri = encodeURI(this.activeSVDiagnostic.resultInfo.ruleHelpUri);
        const locations = this.createLocations(this.activeSVDiagnostic.resultInfo.locations);

        return `
        <div id="resultinfotabcontent" class="tabcontent">
            <table>
                <tr>
                    <td class="td-contentname">${ruleId}</td>
                    <td class="td-contentvalue">${ruleName}</td>
                </tr>
                <tr>
                    <td class="td-contentname">Default level:</td>
                    <td class="td-contentvalue">${ruleDefaultLevel}</td>
                </tr>
                <tr>
                    <td class="td-contentname">Help:</td>
                    <td class="td-contentvalue">
                        <a href="${ruleHelpUri}">${ruleHelpUriText}</a>
                    </td>
                </tr>
                <tr>
                    <td class="td-contentname">Locations:</td>
                    <td class="td-contentvalue">${locations}</td>
                </tr>
            </table>
        </div>`;
    }

    /**
     * Creates the content that shows when the user clicks the runinfo tab
     */
    private createRunInfoTabContent(): string {
        const toolName = this.sanatizeText(this.activeSVDiagnostic.runinfo.toolName);
        const cmdLine = this.sanatizeText(this.activeSVDiagnostic.runinfo.cmdLine);
        const fileName = this.sanatizeText(this.activeSVDiagnostic.runinfo.fileName);
        const workingDir = this.sanatizeText(this.activeSVDiagnostic.runinfo.workingDir);
        return `
        <div id="runinfotabcontent" class="tabcontent">
            <table>
                <tr>
                    <td class="td-contentname">Tool:</td>
                    <td class="td-contentvalue">${toolName}</td>
                </tr>
                <tr>
                    <td class="td-contentname">Command line:</td>
                    <td class="td-contentvalue">${cmdLine}</td>
                </tr>
                <tr>
                    <td class="td-contentname">Filename:</td>
                    <td class="td-contentvalue">${fileName}</td>
                </tr>
                <tr>
                    <td class="td-contentname">Working directory:</td>
                    <td class="td-contentvalue">${workingDir}</td>
                </tr>
            </table>
        </div>`;
    }

    /**
     * Creates the Tabs Container content, the tabs at the top of the tab container
     * @param includeCodeFlow Flag to include the CodeFlow tab in the set of tabs
     */
    private createTabContainerHeaderContent(includeCodeFlow: boolean): string {
        let codeFlowTab = "";
        if (includeCodeFlow) {
            codeFlowTab = this.createTabForTabContainer("codeflowtab", "Code flow", "CODE FLOW");
        }

        return `
        <div id="tabcontainer">
            ${this.createTabForTabContainer("resultinfotab", "Results info", "RESULT INFO")}
            ${codeFlowTab}
            ${this.createTabForTabContainer("runinfotab", "Run info", "RUN INFO")}
        </div>`;
    }

    /**
     * Creates a tab to add to the tab container
     * @param id id of the tab
     * @param tooltip tooltip of the tab
     * @param label text that shows on the tab
     */
    private createTabForTabContainer(id: string, tooltip: string, label: string) {
        return `
        <div id="${id}" class="tab" title="${tooltip}">
            <label class="tablabel">
                ${label}
            </label>
        </div>`;
    }

    /**
     * Sanatizes the number passed in by converting it to a string, escaping any needed characters(currently escapes
     * characters that would effect visible text in the HTML[ &, <, " ]) and parses it back to an int.
     * If it fails to parse back to a number it returns 0.
     * @param input number to be sanatized
     */
    private sanatizeInt(input: number): number {
        let str = input.toString();
        str = str.replace(/&/g, "&amp;");
        str = str.replace(/</g, "&lt;");
        str = str.replace(/"/, "&quot;");

        let value = parseInt(str, 10);
        if (isNaN(value)) {
            value = 0;
        }

        return value;
    }

    /**
     * Sanatizes the string passed in, escaping any needed characters(currently escapes characters that would effect
     * visible text in the HTML[ &, <, " ]).
     * @param input string that needs to be sanatized
     */
    private sanatizeText(input: string): string {
        if (input === undefined) {
            return undefined;
        }
        let output = input.replace(/&/g, "&amp;");
        output = output.replace(/</g, "&lt;");
        output = output.replace(/"/, "&quot;");

        return output;
    }
}
