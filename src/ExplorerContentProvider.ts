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
import { CodeFlow, CodeFlowStep, HTMLElementOptions } from "./Interfaces";
import { Location } from "./Location";
import { ResultInfo } from "./ResultInfo";
import { RunInfo } from "./RunInfo";
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
    private document;

    private constructor() {
        this.textDocContentProRegistration = workspace.registerTextDocumentContentProvider("sarifExplorer", this);
        this.visibleChangeDisposable = window.onDidChangeVisibleTextEditors(
            CodeFlowDecorations.updateStepsHighlight, this);

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
            case "treeselectionchange":
                const selectionId = (request.treeid_step as string).split("_");
                if (selectionId.length === 3) {
                    CodeFlowDecorations.updateSelectionHighlight(parseInt(selectionId[0], 10),
                        parseInt(selectionId[1], 10), parseInt(selectionId[2], 10));
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
    private addNodes(parent: any, steps: CodeFlowStep[], start: number, treeId: number): number {
        for (let index = start; index < steps.length; index++) {

            const node = this.createNode(steps[index]);
            parent.appendChild(node);

            if (steps[index].isParent) {
                index++;
                const childrenContainer = this.createElement("ul");
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

            const headElement = this.createElement("head");
            headElement.appendChild(this.createElement("link", {
                attributes: { rel: "stylesheet", type: "text/css", href: cssMarkup },
            }));

            const bodyElement = this.createBodyContent();

            const scriptElement = this.createElement("script", { attributes: { src: scriptPath } });

            return `
            ${headElement.outerHTML}
            ${bodyElement.outerHTML}
            ${scriptElement.outerHTML}
            `;
        } else {
            return `Select a Sarif result in the Problems panel`;
        }

    }

    /**
     * Creates the body element and content
     */
    private createBodyContent() {
        const resultInfo = this.activeSVDiagnostic.resultInfo;

        const body = this.createElement("body");
        body.appendChild(this.createExplorerHeaderContent(resultInfo));
        body.appendChild(this.createElement("div", { id: "ruledescription", text: resultInfo.message }));

        const codeFlowPanel = this.createCodeFlowPanel(resultInfo.codeFlows);

        const panelContainer = this.createElement("div", { id: "tabContentContainer" });
        panelContainer.appendChild(this.createResultInfoPanel(resultInfo));
        if (codeFlowPanel !== undefined) { panelContainer.appendChild(codeFlowPanel); }
        panelContainer.appendChild(this.createRunInfoPanel(this.activeSVDiagnostic.runinfo));

        body.appendChild(this.createTabHeaderContainer(codeFlowPanel !== undefined));
        body.appendChild(panelContainer);

        return body;
    }

    /**
     * Creates the content that shows when the user clicks the Code Flow tab
     * @param codeFlows Array of code flows to create the content from
     */
    private createCodeFlowPanel(codeFlows: CodeFlow[]): any {
        if (codeFlows !== undefined) {
            const returnEle = this.createElement("div", { id: "codeflowtabcontent", className: "tabcontent" });

            const headerEle = this.createElement("div", { className: "tabcontentheader" });
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
            returnEle.appendChild(headerEle);

            returnEle.appendChild(this.createCodeFlowTrees(codeFlows));

            return returnEle;
        } else {
            return undefined;
        }
    }

    /**
     * Creates a tree for each of the Code Flows
     * @param codeflows array of code flows that need to be displayed
     */
    private createCodeFlowTrees(codeflows: CodeFlow[]): any {
        const returnEle = this.createElement("div", { id: "codeflowtreecontainer" });

        for (let i = 0; i < codeflows.length; i++) {
            const rootEle = this.createElement("ul", { className: "codeflowtreeroot" });
            this.addNodes(rootEle, codeflows[i].threads[0].steps, 0, i);
            returnEle.appendChild(rootEle);
            returnEle.appendChild(this.createElement("br"));
        }

        return returnEle;
    }

    /**
     * Helper function for creating an element and setting some of it's properties
     * @param tagName Type of element to create(div, label, etc.)
     * @param options Additional properties to set on the new element
     */
    private createElement(tagName: string, options?: HTMLElementOptions): any {
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
    private createExplorerHeaderContent(resultInfo: ResultInfo): any {
        const returnEle = this.createElement("div", { id: "title" });

        returnEle.appendChild(this.createElement("label", { id: "titleruleid", text: resultInfo.ruleId }));
        returnEle.appendChild(this.createElement("label", { id: "titlerulename", text: resultInfo.ruleName }));
        returnEle.appendChild(this.createElement("label", { text: " | " }));
        if (resultInfo.locations[0] !== null) {
            const filenameandline = resultInfo.locations[0].fileName + " (" +
                (resultInfo.locations[0].range.start.line + 1/*Range is 0 based*/) + ")";
            returnEle.appendChild(this.createElement("label", { text: filenameandline }));
        }

        return returnEle;
    }

    /**
     * Helper function creates a simple two row column with the name on the left and value on the right
     * For more complex values(not string) you'll need to manually create the element
     * @param name value in the left column
     * @param value value in the right column
     */
    private createNameValueRow(name: string, value: string) {
        const row = this.createElement("tr");
        row.appendChild(this.createElement("td", { className: "td-contentname", text: name }));
        row.appendChild(this.createElement("td", { className: "td-contentvalue", text: value }));

        return row;
    }

    /**
     * Creates a Node for the CodeFlow tree
     * @param cfLocation CodeFlow location to populate the node with
     */
    private createNode(step: CodeFlowStep): any {
        let liClass: string;
        let fileNameAndLine: string;
        let message: string;
        const tooltipText: string = `Step ${step.stepId}: ${step.message}`;

        liClass = "unexpandable";
        message = step.message;
        if (step.location !== undefined) {
            fileNameAndLine = `${step.location.fileName} (${step.location.range.start.line + 1})`;
        } else {
            fileNameAndLine = "[no location]";
        }

        if (step.isParent) {
            liClass = "expanded";
        }

        liClass = liClass + ` ${step.importance || sarif.CodeFlowLocation.importance.important} verbosityshow`;

        const node = this.createElement("li", {
            attributes: { tabindex: "0" }, className: liClass, id: step.traversalId, tooltip: tooltipText,
        });

        node.appendChild(this.createElement("span", { className: "codeflowlocation", text: fileNameAndLine }));
        node.appendChild(this.document.createTextNode(message));

        return node;
    }

    /**
     * Creates the locations content to show in the ResultInfo
     * @param locations Array of ResultLocations to be added to the Html
     */
    private createResultInfoLocations(locations: Location[]): string {
        const element = this.createElement("div");

        for (const location of locations) {
            if (location !== null) {
                const locText = `${location.fileName} (${(location.range.start.line + 1)})`;
                element.appendChild(this.createElement("label",
                    { text: locText, tooltip: location.uri.toString(true) }));
                element.appendChild(this.createElement("br"));
            }
        }

        return element;
    }

    /**
     * Creates the content that shows when the user clicks the resultinfo tab
     * @param resultInfo Result info to create the tab content from
     */
    private createResultInfoPanel(resultInfo: ResultInfo): any {
        const returnEle = this.createElement("div", { id: "resultinfotabcontent", className: "tabcontent" });
        const tableEle = this.createElement("table");

        tableEle.appendChild(this.createNameValueRow(resultInfo.ruleId, resultInfo.ruleName));
        tableEle.appendChild(this.createNameValueRow("Default level:", resultInfo.severityLevel));

        if (resultInfo.ruleHelpUri !== undefined) {
            let helpRow = this.createElement("tr");
            helpRow = this.createElement("tr");
            helpRow.appendChild(this.createElement("td", { className: "td-contentname", text: "Help:" }));
            const helpCell = this.createElement("td", { className: "td-contentvalue" });
            const linkEle = this.createElement("a", { text: resultInfo.ruleHelpUri });
            linkEle.href = resultInfo.ruleHelpUri;
            helpCell.appendChild(linkEle);
            helpRow.appendChild(helpCell);
            tableEle.appendChild(helpRow);
        }

        const locationsRow = this.createElement("tr");
        locationsRow.appendChild(this.createElement("td", { className: "td-contentname", text: "Locations:" }));
        const cell = this.createElement("td", { className: "td-contentvalue" });
        cell.appendChild(this.createResultInfoLocations(resultInfo.locations));
        locationsRow.appendChild(cell);
        tableEle.appendChild(locationsRow);

        returnEle.appendChild(tableEle);

        return returnEle;
    }

    /**
     * Creates the content that shows when the user clicks the runinfo tab
     * @param runInfo Run info to create the tab content from
     */
    private createRunInfoPanel(runInfo: RunInfo): any {
        const returnEle = this.createElement("div", { id: "runinfotabcontent", className: "tabcontent" });
        const tableEle = this.createElement("table");

        if (runInfo.toolName !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Tool:", runInfo.toolName));
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

        returnEle.appendChild(tableEle);

        return returnEle;
    }

    /**
     * Creates the Tabs Container content, the tabs at the top of the tab container
     * @param includeCodeFlow Flag to include the CodeFlow tab in the set of tabs
     */
    private createTabHeaderContainer(includeCodeFlow: boolean): any {
        const element = this.createElement("div", { id: "tabcontainer" });

        element.appendChild(this.createTabElement("resultinfotab", "Results info", "RESULT INFO"));
        if (includeCodeFlow) {
            element.appendChild(this.createTabElement("codeflowtab", "Code flow", "CODE FLOW"));
        }
        element.appendChild(this.createTabElement("runinfotab", "Run info", "RUN INFO"));

        return element;
    }

    /**
     * Creates a tab to add to the tab container
     * @param tabId id of the tab
     * @param tabTooltip tooltip of the tab
     * @param tabText text that shows on the tab
     */
    private createTabElement(tabId: string, tabTooltip: string, tabText: string): any {
        const returnEle = this.createElement("div", { className: "tab", id: tabId, tooltip: tabTooltip });
        returnEle.appendChild(this.createElement("label", { className: "tablabel", text: tabText }));
        return returnEle;
    }
}
