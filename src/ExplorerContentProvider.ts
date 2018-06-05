// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    commands, Disposable, Event, EventEmitter, ExtensionContext, Range, TextDocumentContentProvider,
    Uri, ViewColumn, window, workspace,
} from "vscode";
import { CodeFlowCodeLensProvider } from "./CodeFlowCodeLens";
import { CodeFlowDecorations } from "./CodeFlowDecorations";
import { Attachment, CodeFlow, CodeFlowStep, HTMLElementOptions, TreeNodeOptions } from "./Interfaces";
import { Location } from "./Location";
import { ResultInfo } from "./ResultInfo";
import { RunInfo } from "./RunInfo";
import { SVDiagnostic } from "./SVDiagnostic";
import { Utilities } from "./Utilities";

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
    public codeFlowVerbosity: sarif.CodeFlowLocation.importance;

    private onDidChangeEmitter = new EventEmitter<Uri>();
    private textDocContentProRegistration: Disposable;
    private visibleChangeDisposable: Disposable;
    private document;

    private constructor() {
        this.textDocContentProRegistration = workspace.registerTextDocumentContentProvider("sarifExplorer", this);
        this.visibleChangeDisposable = window.onDidChangeVisibleTextEditors(
            CodeFlowDecorations.onVisibleTextEditorsChanged, this);
        const jsdom = require("jsdom");
        this.document = (new jsdom.JSDOM(``)).window.document;
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
            case "SourceLinkClicked":
                const location = {} as Location;
                location.mapped = true;
                location.uri = Uri.parse(request.file);
                location.range = new Range(parseInt(request.sLine, 10), parseInt(request.sCol, 10),
                    parseInt(request.eLine, 10), parseInt(request.eCol, 10));
                CodeFlowDecorations.updateSelectionHighlight(location, undefined);
                break;
            case "CodeFlowTreeSelectionChange":
                const cFSelectionId = (request.treeid_step as string).split("_");
                if (cFSelectionId.length === 3) {
                    CodeFlowDecorations.updateCodeFlowSelection(parseInt(cFSelectionId[0], 10),
                        parseInt(cFSelectionId[1], 10), parseInt(cFSelectionId[2], 10));
                }
                break;
            case "AttachmentTreeSelectionChange":
                const aSelectionId = (request.treeid_step as string).split("_");
                const attachmentId = parseInt(aSelectionId[0], 10);
                if (aSelectionId.length > 1) {
                    CodeFlowDecorations.updateAttachmentSelection(attachmentId, parseInt(aSelectionId[1], 10));
                } else {
                    const resultInfo = ExplorerContentProvider.Instance.activeSVDiagnostic.resultInfo;
                    commands.executeCommand("vscode.open", resultInfo.attachments[attachmentId].file.uri,
                        ViewColumn.One);
                }
                break;
            case "verbositychanged":
                ExplorerContentProvider.Instance.codeFlowVerbosity = request.verbosity;
                CodeFlowCodeLensProvider.Instance.triggerCodeLensRefresh();
                break;
        }
    }

    /**
     * Provide textual content for a given uri. The editor will use the returned string-content to create a readonly
     * document. Resources allocated should be released when the corresponding document has been closed.
     * @param uri An uri which scheme matches the scheme this provider was registered for.
     */
    public provideTextDocumentContent(uri: Uri): string {
        CodeFlowDecorations.updateStepsHighlight();
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
     * Recursive function that goes through the locations
     * adds a node to it's parent
     * if a node is a "call" the node will become a parent to add the next nodes
     * if a node is a "callreturn" the node will end the recursion
     * @param parent Parent html element to add the children to
     * @param steps Array of all of the locations in the tree
     * @param start Starting point in the Array
     * @param treeId Id of the tree
     */
    private addNodes(parent: HTMLUListElement, steps: CodeFlowStep[], start: number, treeId: number): number {
        for (let index = start; index < steps.length; index++) {

            const node = this.createCodeFlowNode(steps[index]);
            parent.appendChild(node);

            if (steps[index].isParent) {
                index++;
                const childrenContainer = this.createElement("ul") as HTMLUListElement;
                index = this.addNodes(childrenContainer, steps, index, treeId);
                node.appendChild(childrenContainer);
            } else if (steps[index].isLastChild) {
                // if it's a callReturn we want to pop out of the recursion returning the index we stopped at
                return index;
            }
        }

        // finished all of the elements in the locations
        return steps.length;
    }

    /**
     * Primary function that generates the HTML displayed in the Explorer window
     */
    private assembleExplorerContent(): string {
        if (this.activeSVDiagnostic !== undefined) {
            const cssMarkup = Uri.file(this.context.asAbsolutePath("out/explorer/explorer.css")).toString();
            const scriptPath = Uri.file(this.context.asAbsolutePath("out/explorer/explorer.js")).toString();

            const head = this.createElement("head") as HTMLHeadElement;
            head.appendChild(this.createElement("link", {
                attributes: { rel: "stylesheet", type: "text/css", href: cssMarkup },
            }));

            const body = this.createBodyContent();

            const script = this.createElement("script", { attributes: { src: scriptPath } }) as HTMLScriptElement;

            return `
            ${head.outerHTML}
            ${body.outerHTML}
            ${script.outerHTML}
            `;
        } else {
            return `Select a Sarif result in the Problems panel`;
        }

    }

    /**
     * Creates the body element and content
     */
    private createBodyContent(): HTMLBodyElement {
        const resultInfo = this.activeSVDiagnostic.resultInfo;

        const body = this.createElement("body") as HTMLBodyElement;
        body.appendChild(this.createExplorerHeaderContent(resultInfo));
        const ruleDescription = this.createElement("div", { id: "ruledescription" });
        ruleDescription.appendChild(resultInfo.message.html);
        body.appendChild(ruleDescription);

        const tabHeader = this.createTabHeaderContainer(resultInfo.codeFlows !== undefined,
            resultInfo.attachments !== undefined);
        body.appendChild(tabHeader);

        // Create and add the panels
        const panelContainer = this.createElement("div", { id: "tabContentContainer" }) as HTMLDivElement;
        panelContainer.appendChild(this.createPanelResultInfo(resultInfo));
        panelContainer.appendChild(this.createPanelCodeFlow(resultInfo.codeFlows));
        panelContainer.appendChild(this.createPanelRunInfo(this.activeSVDiagnostic.runinfo));
        panelContainer.appendChild(this.createPanelAttachments(resultInfo.attachments));
        body.appendChild(panelContainer);

        return body;
    }

    /**
     * Creates a tree for each of the Code Flows
     * @param codeflows array of code flows that need to be displayed
     */
    private createCodeFlowTrees(codeflows: CodeFlow[]): HTMLDivElement {
        const container = this.createElement("div", { id: "codeflowtreecontainer" }) as HTMLDivElement;

        for (let i = 0; i < codeflows.length; i++) {
            const rootEle = this.createElement("ul", { className: "codeflowtreeroot" }) as HTMLUListElement;
            this.addNodes(rootEle, codeflows[i].threads[0].steps, 0, i);
            container.appendChild(rootEle);
            container.appendChild(this.createElement("br"));
        }

        return container;
    }

    /**
     * Helper function for creating an element and setting some of it's properties
     * @param tagName Type of element to create(div, label, etc.)
     * @param options Additional properties to set on the new element
     */
    private createElement(tagName: string, options?: HTMLElementOptions): HTMLElement {
        const ele = this.document.createElement(tagName);
        if (options !== undefined) {
            if (options.text !== undefined) { ele.textContent = options.text; }
            if (options.id !== undefined) { ele.id = options.id; }
            if (options.className !== undefined) { ele.className = options.className; }
            if (options.tooltip !== undefined) { ele.setAttribute("title", options.tooltip); }

            for (const name in options.attributes) {
                if (options.attributes.hasOwnProperty(name)) {
                    ele.setAttribute(name, options.attributes[name]);
                }
            }
        }

        return ele;
    }

    /**
     * Creates the content that shows in the header of the Explorer window
     */
    private createExplorerHeaderContent(resultInfo: ResultInfo): HTMLDivElement {
        const header = this.createElement("div", { id: "title" }) as HTMLDivElement;

        header.appendChild(this.createElement("label", { id: "titleruleid", text: resultInfo.ruleId }));
        header.appendChild(this.createElement("label", { id: "titlerulename", text: resultInfo.ruleName }));
        header.appendChild(this.createElement("label", { text: " | " }));
        if (resultInfo.locations[0] !== undefined) {
            const filenameandline = resultInfo.locations[0].fileName + " (" +
                (resultInfo.locations[0].range.start.line + 1/*Range is 0 based*/) + ")";
            header.appendChild(this.createElement("label", { text: filenameandline }));
        }

        return header;
    }

    /**
     * Helper function creates a simple two row column with the name on the left and value on the right
     * For more complex values(not string) you'll need to manually create the element
     * @param name value in the left column
     * @param value value in the right column
     * @param valueTooltip tooltip to show over the value in right column
     */
    private createNameValueRow(name: string, value: string, valueTooltip?: string) {
        const row = this.createElement("tr") as HTMLTableRowElement;
        row.appendChild(this.createElement("td", { className: "td-contentname", text: name }));
        if (valueTooltip === undefined) { valueTooltip = value; }
        row.appendChild(this.createElement("td", { className: "td-contentvalue", text: value, tooltip: valueTooltip }));

        return row;
    }

    /**
     * Creates a tree node for a codeflow step
     * @param step CodeFlow step to crete a node for
     */
    private createCodeFlowNode(step: CodeFlowStep): HTMLLIElement {
        const nodeClass = `${step.importance || sarif.CodeFlowLocation.importance.important} verbosityshow`;
        let fileNameAndLine: string;
        if (step.location !== undefined) {
            fileNameAndLine = `${step.location.fileName} (${step.location.range.start.line + 1})`;
        }

        const treeNodeOptions = {
            isParent: step.isParent, liClass: nodeClass, locationText: fileNameAndLine, message: step.message,
            requestId: step.traversalId, tooltip: step.messageWithStep,
        } as TreeNodeOptions;
        return this.createNode(treeNodeOptions);
    }

    /**
     * Creates a tree node
     * @param options TreeNodeOptions to determine the settings for the node
     */
    private createNode(options: TreeNodeOptions): HTMLLIElement {
        if (options.isParent === true) {
            options.liClass = "expanded " + options.liClass;
        } else {
            options.liClass = "unexpandable " + options.liClass;
        }

        if (options.locationText === undefined) {
            options.locationText = "[no location]";
        }

        const node = this.createElement("li", {
            attributes: { tabindex: "0" }, className: options.liClass, id: options.requestId, tooltip: options.tooltip,
        }) as HTMLLIElement;

        node.appendChild(this.createElement("span", { className: "treenodelocation", text: options.locationText }));
        node.appendChild(this.document.createTextNode(options.message));

        return node;
    }

    /**
     * Creates a row with location links, returns undefined if no locations are displayable
     * @param rowName name to show up on the left side of the row
     * @param locations Array of Locations to be added to the Html
     */
    private createLocationsRow(rowName: string, locations: Location[]): HTMLTableRowElement {
        const cellContents = this.createElement("div") as HTMLDivElement;

        let locationsAdded = 0;
        for (const location of locations) {
            if (location !== undefined) {
                const text = `${location.fileName} (${(location.range.start.line + 1)})`;
                const link = Utilities.createSourceLink(location, text);
                cellContents.appendChild(link);
                cellContents.appendChild(this.createElement("br"));
                locationsAdded++;
            }
        }

        if (locationsAdded === 0) {
            return undefined;
        }

        return this.createRowWithContents(rowName, cellContents);
    }

    /**
     * Creates the base panel
     * @param name name used for the panels id
     */
    private createPanel(name: string): HTMLDivElement {
        return this.createElement("div", { id: name + "tabcontent", className: "tabcontent" }) as HTMLDivElement;
    }

    /**
     * Creates a Panel that shows the Attachments of a result
     * @param attachments Array of Attachment objects to create the panel with
     */
    private createPanelAttachments(attachments: Attachment[]): HTMLDivElement {
        const panel = this.createPanel("attachments");

        if (attachments !== undefined) {
            const rootEle = this.createElement("ul", { className: "attachmentstreeroot" }) as HTMLUListElement;
            for (const aIndex of attachments.keys()) {
                let isAParent = false;
                const attachment = attachments[aIndex];
                if (attachment.regionsOfInterest !== undefined) { isAParent = true; }
                let treeNodeOptions = {
                    isParent: isAParent, locationText: attachment.file.fileName, message: attachment.description.text,
                    requestId: `${aIndex}`, tooltip: attachment.file.uri.toString(true),
                } as TreeNodeOptions;
                const parent = this.createNode(treeNodeOptions);
                if (isAParent) {
                    const childrenContainer = this.createElement("ul") as HTMLUListElement;
                    for (const rIndex of attachment.regionsOfInterest.keys()) {
                        const region = attachment.regionsOfInterest[rIndex];
                        let regionText = "No Description";
                        if (region.message !== undefined) {
                            regionText = region.message.text;
                        }
                        const locText = `(${region.range.start.line + 1},${region.range.start.character + 1})`;
                        treeNodeOptions = {
                            isParent: false, locationText: locText, message: regionText,
                            requestId: `${aIndex}_${rIndex}`, tooltip: regionText,
                        } as TreeNodeOptions;

                        childrenContainer.appendChild(this.createNode(treeNodeOptions));
                    }

                    parent.appendChild(childrenContainer);
                }
                rootEle.appendChild(parent);
            }

            panel.appendChild(rootEle);
        }
        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the Code Flow tab
     * @param codeFlows Array of code flows to create the content from
     */
    private createPanelCodeFlow(codeFlows: CodeFlow[]): HTMLDivElement {
        const panel = this.createPanel("codeflow");
        if (codeFlows !== undefined) {
            const headerEle = this.createElement("div", { className: "tabcontentheader" }) as HTMLDivElement;
            headerEle.appendChild(this.createElement("div", {
                className: "tabcontentheaderbutton", id: "expandallcodeflow", text: "+", tooltip: "Expand All",
            }));
            headerEle.appendChild(this.createElement("div", {
                className: "tabcontentheaderbutton", id: "collapseallcodeflow", text: "-", tooltip: "Collapse All",
            }));
            headerEle.appendChild(this.createElement("div", { className: "tabcontentheadersperator", text: "|" }));
            headerEle.appendChild(this.createElement("input", {
                attributes: { max: "2", type: "range" }, id: "codeflowverbosity", tooltip: "Tree Verbosity",
            }));
            panel.appendChild(headerEle);

            panel.appendChild(this.createCodeFlowTrees(codeFlows));
        }

        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the resultinfo tab
     * @param resultInfo Result info to create the tab content from
     */
    private createPanelResultInfo(resultInfo: ResultInfo): HTMLDivElement {
        const panel = this.createPanel("resultinfo");
        const tableEle = this.createElement("table") as HTMLTableElement;

        tableEle.appendChild(this.createNameValueRow(resultInfo.ruleId, resultInfo.ruleName));
        const severity = this.severityValueAndTooltip(resultInfo.severityLevel);
        tableEle.appendChild(this.createNameValueRow("Severity level:", severity.text, severity.tooltip));

        if (resultInfo.ruleHelpUri !== undefined) {
            const cellContents = this.createElement("a", { text: resultInfo.ruleHelpUri }) as HTMLAnchorElement;
            cellContents.href = resultInfo.ruleHelpUri;
            tableEle.appendChild(this.createRowWithContents("Help: ", cellContents));
        }

        let row = this.createLocationsRow("Locations: ", resultInfo.locations);
        if (row !== undefined) {
            tableEle.appendChild(row);
        }

        row = this.createLocationsRow("Related: ", resultInfo.relatedLocs);
        if (row !== undefined) {
            tableEle.appendChild(row);
        }

        // The last item in the list should be properties if they exist
        if (resultInfo.additionalProperties !== undefined) {
            tableEle.appendChild(this.createPropertiesRow(resultInfo.additionalProperties));
        }

        panel.appendChild(tableEle);

        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the runinfo tab
     * @param runInfo Run info to create the tab content from
     */
    private createPanelRunInfo(runInfo: RunInfo): HTMLDivElement {
        const panel = this.createPanel("runinfo");
        const tableEle = this.createElement("table") as HTMLTableElement;

        if (runInfo.toolName !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Tool:", runInfo.toolFullName));
        }
        if (runInfo.cmdLine !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Command line:", runInfo.cmdLine));
        }
        if (runInfo.fileName !== undefined) {
            tableEle.appendChild(this.createNameValueRow("File name:", runInfo.fileName));
        }
        if (runInfo.workingDir !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Working directory:", runInfo.workingDir));
        }

        // The last item in the list should be properties if they exist
        if (runInfo.additionalProperties !== undefined) {
            tableEle.appendChild(this.createPropertiesRow(runInfo.additionalProperties));
        }

        panel.appendChild(tableEle);

        return panel;
    }

    /**
     * Creates a row with an html element for it's value cell, useful for multiline values such as locations
     * @param rowName name to show up on the left side of the row
     * @param contents html element to add to the value cell
     */
    private createRowWithContents(rowName: string, contents: HTMLElement): HTMLTableRowElement {
        const row = this.createElement("tr") as HTMLTableRowElement;
        row.appendChild(this.createElement("td", { className: "td-contentname", text: rowName }));
        const cell = this.createElement("td", { className: "td-contentvalue" }) as HTMLTableDataCellElement;
        cell.appendChild(contents);
        row.appendChild(cell);
        return row;
    }

    /**
     * Creates the properties content to show
     * @param properties the properties object that has the bag of additional properties
     */
    private createPropertiesRow(properties: { [key: string]: string }): HTMLTableRowElement {
        const cellContents = this.createElement("div") as HTMLDivElement;
        for (const propName in properties) {
            if (properties.hasOwnProperty(propName)) {
                const propText = `${propName}: ${properties[propName]}`;
                cellContents.appendChild(this.createElement("label", { text: propText, tooltip: propText }));
                cellContents.appendChild(this.createElement("br"));
            }
        }

        return this.createRowWithContents("Properties: ", cellContents);
    }

    /**
     * Creates the Tabs Container content, the tabs at the top of the tab container
     * @param hasCodeFlows Flag to include the CodeFlow tab in the set of tabs
     * @param hasAttachments Flag to include the Attachments tab in the set of tabs
     */
    private createTabHeaderContainer(hasCodeFlows: boolean, hasAttachments: boolean): HTMLDivElement {
        const container = this.createElement("div", { id: "tabcontainer" }) as HTMLDivElement;

        container.appendChild(this.createTabElement("resultinfotab", "Results info", "RESULT INFO"));
        if (hasCodeFlows) {
            container.appendChild(this.createTabElement("codeflowtab", "Code flow", "CODE FLOW"));
        }
        container.appendChild(this.createTabElement("runinfotab", "Run info", "RUN INFO"));
        if (hasAttachments) {
            container.appendChild(this.createTabElement("attachmentstab", "Attachments", "ATTACHMENTS"));
        }

        return container;
    }

    /**
     * Creates a tab to add to the tab container
     * @param tabId id of the tab
     * @param tabTooltip tooltip of the tab
     * @param tabText text that shows on the tab
     */
    private createTabElement(tabId: string, tabTooltip: string, tabText: string): HTMLDivElement {
        const returnEle = this.createElement("div",
            { className: "tab", id: tabId, tooltip: tabTooltip }) as HTMLDivElement;
        returnEle.appendChild(this.createElement("label", { className: "tablabel", text: tabText }));
        return returnEle;
    }

    /**
     * Gets the text and tooltip(a reduced version of the specs description) based on the result's severity level
     * @param severity the results severity level
     */
    private severityValueAndTooltip(severity: sarif.Result.level) {
        switch (severity) {
            case sarif.Result.level.error:
                return { text: "Error", tooltip: "The rule was evaluated, and a serious problem was found." };
            case sarif.Result.level.warning:
                return { text: "Warning", tooltip: "The rule was evaluated, and a problem was found." };
            case sarif.Result.level.open:
                return {
                    text: "Open", tooltip: "The rule was evaluated, and the tool concluded that there was " +
                        "insufficient information to decide whether a problem exists.",
                };
            case sarif.Result.level.note:
                return { text: "Note", tooltip: "A purely informational log entry" };
            case sarif.Result.level.notApplicable:
                return {
                    text: "Not Applicable",
                    tooltip: "The rule was not evaluated, because it does not apply to the analysis target.",
                };
            case sarif.Result.level.pass:
                return { text: "Pass", tooltip: "The rule was evaluated, and no problem was found." };
        }
    }
}
