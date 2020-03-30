/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

/// <reference path="./enums.ts" />
/// <reference path="./resultsList.ts" />

import * as sarif from "sarif";
import { Position } from "vscode";
import {
    Attachment, CodeFlow, CodeFlowStep, DiagnosticData, Fix, HTMLElementOptions, Location, LocationData, Message,
    ResultInfo, RunInfo, Stack, Stacks, TreeNodeOptions, WebviewMessage, ThreadFlow, StackHeaderType
} from "../common/Interfaces";

import { ResultsList } from "./resultsList";
import { TextAndTooltip } from "./textAndTooltip";
import { getElementFromEvent, getDocumentElementById, getDocumentElementsByClassName, getOptionalDocumentElementById, getElementChildren, removeElementChildren } from "./documentUtilities";

// Types used to map between the verbosity level (0-2, where 2 is show everything)
type verbosityClassStates = "verbosityshow" | "verbosityhide";

interface VerbosityState {
    importantClass: verbosityClassStates;
    unimportantClass: verbosityClassStates;
    verbosityRequest: sarif.ThreadFlowLocation.importance;
}

const verbosityLevels: Map<string, VerbosityState> = new Map<string, VerbosityState>([
    ["0", { importantClass: "verbosityhide", unimportantClass: "verbosityhide", verbosityRequest: "essential" }],
    ["1", { importantClass: "verbosityshow", unimportantClass: "verbosityhide", verbosityRequest: "important" }],
    ["2", { importantClass: "verbosityshow", unimportantClass: "verbosityshow", verbosityRequest: "unimportant" }]]);

const stackHeaderNames: {headerType: StackHeaderType; uiString: string} []  = [
    { headerType: 'result', uiString:  ""},
    { headerType: 'message', uiString: "Message" },
    { headerType: 'name', uiString: "Name" },
    { headerType: 'location', uiString: "Line" },
    { headerType: 'filename', uiString:  "File" },
    { headerType: 'parameters', uiString: "Parameters" },
    { headerType: 'threadId', uiString: "ThreadId "}];

/**
 * This class handles generating and providing the HTML content for the Explorer panel
 */
export class ExplorerWebview {
    private vscode: {
        postMessage: (message: WebviewMessage) => void;
    };

    public diagnostic: DiagnosticData | undefined;

    private hasCodeFlows: boolean = false;
    private hasAttachments: boolean = false;
    private hasFixes: boolean = false;
    private hasStacks: boolean = false;
    private resultsList: ResultsList;

    public constructor() {
        // @ts-ignore: acquireVsCodeApi function is provided real time in the webview
        this.vscode = acquireVsCodeApi();
        this.resultsList = new ResultsList(this);

        window.addEventListener("message", this.onMessage.bind(this));
    }

    /**
     * Called when the extension sends a message to the webview, this handles reacting to the message
     * @param event event sent from the extension, that has the WebviewMessage in it's data property
     */
    // tslint:disable-next-line: no-any
    public onMessage(event: any): void {
        const message: WebviewMessage = event.data as WebviewMessage;
        switch (message.type) {
            case MessageType.NewDiagnostic:
                this.setDiagnostic(message.data);
                this.resultsList.updateSelection();
                break;
            case MessageType.CodeFlowSelectionChange:
                this.showTreeNode(message.data, true);
                break;
            case MessageType.ResultsListDataSet:
                this.resultsList.Data = JSON.parse(message.data);
                break;
        }
    }

    /**
     * handles sending the webviewmessage to the extension
     * @param message message to send to the extension
     */
    public sendMessage(message: WebviewMessage): void {
        this.vscode.postMessage(message);
    }

    /**
     * Helper function for creating an element and setting some of it's properties
     * @param tagName Type of element to create(div, label, etc.)
     * @param options Additional properties to set on the new element
     */
    public createElement<T extends HTMLElement>(tagName: string, options?: HTMLElementOptions): T {
        const ele: T = <T>document.createElement(tagName);

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
     * Recursive function that goes through the locations
     * adds a node to it's parent
     * if a node is a "call" the node will become a parent to add the next nodes
     * if a node is a "callreturn" the node will end the recursion
     * @param parent Parent html element to add the children to
     * @param steps Array of all of the locations in the tree
     * @param start Starting point in the Array, if negative it will create placeholders(used when first step is nested)
     */
    private addCodeFlowNodes(parent: HTMLUListElement, steps: CodeFlowStep[], start: number): number {
        for (let index: number = start; index < steps.length; index++) {
            const node: HTMLLIElement = this.createCodeFlowNode(steps[index]);
            parent.appendChild(node);
            if (index < 0 || steps[index].isParent) {
                index++;
                const childrenContainer: HTMLUListElement = this.createElement("ul");
                index = this.addCodeFlowNodes(childrenContainer, steps, index);
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
     * Cleans up the result details section, removing event handlers and elements
     */
    private cleanUpResultDetails(): void {
        // Remove event handlers
        const tabContainer: HTMLElement | undefined = getOptionalDocumentElementById(document, "tabcontainer", HTMLElement);
        if (tabContainer) {
            for (const tabContainerElement of getElementChildren(tabContainer, HTMLDivElement)) {
                tabContainerElement.removeEventListener("click", this.onTabClicked.bind(this));
            }
        }

        const sourceLinks: HTMLCollectionOf<HTMLAnchorElement> = getDocumentElementsByClassName(document, "sourcelink", HTMLAnchorElement);
        for (const sourceLink of sourceLinks) {
            sourceLink.removeEventListener("click", this.onSourceLinkClicked);
        }

        if (this.hasCodeFlows) {
            const codeFlowTrees: HTMLCollectionOf<HTMLUListElement> = getDocumentElementsByClassName(document, "codeflowtreeroot", HTMLUListElement);
            for (const codeFlowTree of codeFlowTrees) {
                codeFlowTree.removeEventListener("click", this.onCodeFlowTreeClicked.bind(this));
            }

            let element: HTMLDivElement = getDocumentElementById(document, "expandallcodeflow", HTMLDivElement);
            element.removeEventListener("click", this.onCollapseAllClicked.bind(this));

            element = getDocumentElementById(document, "collapseallcodeflow", HTMLDivElement);
            element.removeEventListener("click", this.onCollapseAllClicked.bind(this));

            const verbosityElement: HTMLInputElement = getDocumentElementById(document, "codeflowverbosity", HTMLInputElement);
            verbosityElement.removeEventListener("click", this.onVerbosityChange.bind(this));
        }

        if (this.hasAttachments) {
            const attachmentTrees: HTMLCollectionOf<HTMLUListElement> = getDocumentElementsByClassName(document, "attachmentstreeroot", HTMLUListElement);
            for (const attachmentTree of attachmentTrees) {
                attachmentTree.removeEventListener("click", this.onAttachmentClicked.bind(this));
            }
        }

        // Clear Result Details
        removeElementChildren(document.getElementById("resultdetailsheader"));
        removeElementChildren(document.getElementById("resultdetailscontainer"));
    }

    /**
     * Creates a tree node for a codeflow step
     * @param step CodeFlow step to crete a node for
     */
    private createCodeFlowNode(step: CodeFlowStep): HTMLLIElement {
        let treeNodeOptions: TreeNodeOptions;
        if (step !== undefined) {
            const nodeClass: string = `${step.importance || "important"} verbosityshow`;
            treeNodeOptions = {
                isParent: step.isParent,
                liClass: nodeClass,
                location: step.location,
                message: step.message,
                requestId: step.traversalId,
                tooltip: step.messageWithStep,
            };
        } else {
            // Placeholder node
            treeNodeOptions = {
                isParent: true,
                liClass: `${"essential"} verbosityshow`,
                message: "Nested first step",
                requestId: "-1",
                tooltip: "First step starts in a nested call",
            };
        }

        return this.createNode(treeNodeOptions);
    }

    /**
     * Creates a tree for each of the Code Flows
     * @param codeflows array of code flows that need to be displayed
     */
    private createCodeFlowTrees(codeflows: CodeFlow[]): HTMLDivElement {
        const container: HTMLDivElement = this.createElement("div", { id: "codeflowtreecontainer" });

        for (const codeflow of codeflows) {
            const rootEle: HTMLUListElement = this.createElement("ul", { className: "codeflowtreeroot" });
            const thread: ThreadFlow = codeflow.threads[0];
            this.addCodeFlowNodes(rootEle, thread.steps, 0 - thread.lvlsFirstStepIsNested);
            rootEle.addEventListener("click", this.onCodeFlowTreeClicked.bind(this));
            container.appendChild(rootEle);
        }

        return container;
    }

    /**
     * Creates the content that shows in the results details header of the Explorer window
     */
    private createResultDetailsHeader(resultInfo: ResultInfo): void {
        const header: HTMLDivElement = getDocumentElementById(document, "resultdetailsheader", HTMLDivElement);

        if (resultInfo.ruleId !== undefined || resultInfo.ruleName !== undefined) {
            header.appendChild(this.createElement("label", { id: "titleruleid", text: resultInfo.ruleId }));
            header.appendChild(this.createElement("label", { id: "titlerulename", text: resultInfo.ruleName }));
        } else {
            const severity: TextAndTooltip = this.severityTextAndTooltip(resultInfo.severityLevel);
            header.appendChild(this.createElement("label", { id: "titlerulename", text: severity.text }));
        }
        header.appendChild(this.createElement("label", { text: " | " }));

        let filenameandline: string = "No Location";
        const resultLocation: Location = resultInfo.locations[0];
        if (resultLocation) {
            if (resultLocation.uri && resultLocation.range) {
                filenameandline = `${resultLocation.fileName} (${resultLocation.range.start.line + 1/*Convert 0 based*/})`;
            } else if (resultLocation.logicalLocations !== undefined && resultLocation.logicalLocations.length > 0) {
                filenameandline = resultLocation.logicalLocations[0];
            }
        }

        header.appendChild(this.createElement("label", { text: filenameandline }));
        header.addEventListener("click", this.onHeaderClicked.bind(this));
    }

    /**
     * Creates a row with location links, returns undefined if no locations are displayable
     * @param rowName name to show up on the left side of the row
     * @param locations Array of Locations to be added to the Html
     */
    private createLocationsRow(rowName: string, locations: Location[]): HTMLTableRowElement | undefined {
        const cellContents: HTMLDivElement = this.createElement("div");

        let locationsAdded: boolean = false;

        for (const loc of locations) {
            if (!loc || !loc.range) {
                continue;
            }

            const text: string = `${loc.fileName} (${(loc.range.start.line + 1)})`;
            const link: HTMLAnchorElement | undefined = this.createSourceLink(loc, text);

            if (!link) {
                continue;
            }
            cellContents.appendChild(link);
            cellContents.appendChild(this.createElement("br"));
            locationsAdded = true;
        }

        return locationsAdded ? this.createRowWithContents(rowName, cellContents) : undefined;
    }

    /**
     * Creates a row with logical locations, returns undefined if no logical locations are displayable
     * @param rowName name to show up on the left side of the row
     * @param locations Array of Locations to be added to the Html
     */
    private createLogicalLocationsRow(rowName: string, locations: Location[]): HTMLTableRowElement | undefined {
        const cellContents: HTMLDivElement = this.createElement("div");

        let locationsAdded: boolean = false;
        for (const loc of locations) {
            if (!loc || !loc.logicalLocations) {
                continue;
            }

            for (const logLoc of loc.logicalLocations) {
                const text: HTMLSpanElement = this.createElement("span", { text: logLoc });
                cellContents.appendChild(text);
                cellContents.appendChild(this.createElement("br"));
                locationsAdded = true;
            }
        }

        return locationsAdded ? this.createRowWithContents(rowName, cellContents) : undefined;
    }

    /**
     * Helper function creates a simple two row column with the name on the left and value on the right
     * For more complex values(not string) you'll need to manually create the element
     * @param name value in the left column
     * @param value value in the right column
     * @param valueTooltip tooltip to show over the value in right column
     * @param isHtml flag to set if the @param value is html so it gets set via innerHtml *note* only set on safe values
     */
    private createNameValueRow(name: string, value: string, valueTooltip?: string, isHtml?: boolean): HTMLTableRowElement {
        const row: HTMLTableRowElement = this.createElement("tr");
        row.appendChild(this.createElement("td", { className: "td-contentname", text: name }));
        if (valueTooltip === undefined) { valueTooltip = value; }
        if (isHtml === true) {
            const cont: HTMLTableCellElement = this.createElement("td", { className: "td-contentvalue", tooltip: valueTooltip });
            cont.innerHTML = value;
            row.appendChild(cont);
        } else {
            const cont: HTMLTableCellElement = this.createElement("td", { className: "td-contentvalue", text: value, tooltip: valueTooltip });
            row.appendChild(cont);
        }

        return row;
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

        if (options.location !== undefined) {
            if (options.logicalLocation === undefined) {
                const optLogLocs: string[] | undefined = options.location.logicalLocations;
                if (optLogLocs !== undefined && optLogLocs.length > 0) {
                    options.logicalLocation = optLogLocs[0];
                }
            }

            if (options.locationText === undefined) {
                options.locationText = options.location.fileName;
            }

            if (options.location.range && options.locationText !== undefined && options.locationLine === undefined) {
                const locRange: Position = options.location.range.start;
                options.locationLine = `(${locRange.line + 1},${locRange.character + 1})`;
            }

            if (options.location.message && options.message === undefined) {
                options.message = options.location.message.text;
            }

            if (options.tooltip === undefined) {
                if (options.message !== undefined) {
                    options.tooltip = options.message;
                } else if (options.location.uri !== undefined) {
                    // @ts-ignore external exist on the webview side
                    options.tooltip = options.location.uri.external.replace("%3A", ":");
                }
            }
        }

        if (options.locationText === undefined) {
            options.locationText = options.logicalLocation || "[no location]";
        }

        if (options.locationLine === undefined) {
            options.locationLine = "";
        }

        if (options.message === undefined) {
            options.message = "[no description]";
        }

        if (options.tooltip === undefined) {
            options.tooltip = options.message;
        }

        const node: HTMLLIElement = this.createElement("li", {
            attributes: { tabindex: "0" }, className: options.liClass, id: options.requestId, tooltip: options.tooltip,
        });

        const locationTooltip: string | undefined = options.locationText + options.locationLine;
        node.appendChild(this.createElement("span", {
            className: "treenodeline", text: options.locationLine, tooltip: locationTooltip,
        }));
        node.appendChild(this.createElement("span", {
            className: "treenodelocation", text: options.locationText, tooltip: locationTooltip,
        }));
        node.appendChild(document.createTextNode(options.message));

        return node;
    }

    /**
     * Creates the base panel
     * @param name name used for the panels id
     */
    private createPanel(name: tabNames): HTMLDivElement {
        return this.createElement("div", { id: name + "content", className: "tabcontent" }) as HTMLDivElement;
    }

    /**
     * Creates a Panel that shows the Attachments of a result
     * @param attachments Array of Attachment objects to create the panel with
     */
    private createPanelAttachments(attachments: Attachment[]): HTMLDivElement {
        const panel: HTMLDivElement = this.createPanel(tabNames.attachments);

        if (attachments.length === 0) {
            return panel;
        }

        const rootEle: HTMLUListElement = this.createElement("ul", { className: "attachmentstreeroot" });
        for (const aIndex of attachments.keys()) {
            let isAParent: boolean = false;
            const attachment: Attachment = attachments[aIndex];
            if (attachment.regionsOfInterest !== undefined) { isAParent = true; }
            const treeNodeOptions: TreeNodeOptions = {
                isParent: isAParent,
                location: attachment.file,
                message: attachment.description.text,
                requestId: `${aIndex}`,
            };
            const parent: HTMLLIElement = this.createNode(treeNodeOptions);
            if (isAParent) {
                const childrenContainer: HTMLUListElement = this.createElement("ul");
                for (const rIndex of attachment.regionsOfInterest.keys()) {
                    const region: Location = attachment.regionsOfInterest[rIndex];
                    const treeNodeOptions: TreeNodeOptions = {
                        isParent: false,
                        locationText: "",
                        message: region.message && region.message.text,
                        requestId: `${aIndex}_${rIndex}`,
                    };

                    childrenContainer.appendChild(this.createNode(treeNodeOptions));
                }

                parent.appendChild(childrenContainer);
            }
            rootEle.appendChild(parent);
        }

        rootEle.addEventListener("click", this.onAttachmentClicked.bind(this));
        panel.appendChild(rootEle);

        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the Code Flow tab
     * @param codeFlows Array of code flows to create the content from
     */
    private createPanelCodeFlow(codeFlows: CodeFlow[]): HTMLDivElement {
        const panel: HTMLDivElement = this.createPanel(tabNames.codeflow);
        if (codeFlows.length === 0) {
            return panel;
        }
        const headerEle: HTMLDivElement = this.createElement("div", { className: "tabcontentheader" });

        const expandAll: HTMLDivElement = this.createElement("div", {
            className: "tabcontentheaderbutton", id: "expandallcodeflow", text: "+", tooltip: "Expand All",
        });
        expandAll.addEventListener("click", this.onExpandAllClicked.bind(this));
        headerEle.appendChild(expandAll);

        const collapseAll: HTMLDivElement = this.createElement("div", {
            className: "tabcontentheaderbutton", id: "collapseallcodeflow", text: "-", tooltip: "Collapse All",
        });
        collapseAll.addEventListener("click", this.onCollapseAllClicked.bind(this));
        headerEle.appendChild(collapseAll);

        headerEle.appendChild(this.createElement("div", { className: "headercontentseperator", text: "|" }));

        const verbosity: HTMLInputElement = this.createElement("input", {
            attributes: { max: "2", type: "range" }, id: "codeflowverbosity", tooltip: "Tree Verbosity",
        });
        verbosity.addEventListener("change", this.onVerbosityChange.bind(this));
        headerEle.appendChild(verbosity);
        panel.appendChild(headerEle);

        panel.appendChild(this.createCodeFlowTrees(codeFlows));

        return panel;
    }

    /**
     * Creates a Panel that shows the Fixes of a result
     * @param fixes Array of Fixes objects to create the panel with
     */
    private createPanelFixes(fixes: Fix[]): HTMLDivElement {
        const panel: HTMLDivElement = this.createPanel(tabNames.fixes);

        if (fixes.length === 0) {
            return panel;
        }

        const rootEle: HTMLUListElement = this.createElement("ul", { className: "fixestreeroot" });
        for (const [fixIndex, fix] of fixes.entries()) {
            const hasFiles: boolean = fix.files !== undefined && fix.files.length > 0;
            const fixRootNodeOptions: TreeNodeOptions = {
                isParent: hasFiles,
                locationText: "",
                message: fix.description.text,
                requestId: `${fixIndex}`,
            };
            const fixRootNode: HTMLLIElement = this.createNode(fixRootNodeOptions);
            rootEle.appendChild(fixRootNode);

            if (!hasFiles) {
                continue;
            }

            const filesContainer: HTMLUListElement = this.createElement("ul");
            fixRootNode.appendChild(filesContainer);
            for (const fixFile of fix.files.values()) {
                const hasChanges: boolean = fixFile.changes !== undefined && fixFile.changes.length > 0;
                const fileNodeOptions: TreeNodeOptions = {
                    isParent: true, locationText: "", message: fixFile.location.fileName,
                    requestId: `${fixIndex}`, tooltip: fixFile.location.uri ? fixFile.location.uri.fsPath : "",
                };
                const fileNode: HTMLLIElement = this.createNode(fileNodeOptions);
                filesContainer.appendChild(fileNode);

                if (!hasChanges) {
                    continue;
                }
                const changesContainer: HTMLUListElement = this.createElement("ul");
                fileNode.appendChild(changesContainer);

                for (const [changeIndex, change] of fixFile.changes.entries()) {
                    const changeMsg: string  = `Change ${changeIndex + 1}`;
                    const changeNodeOptions: TreeNodeOptions = {
                        isParent: true,
                        locationText: "",
                        message: changeMsg,
                        requestId: `${fixIndex}`,
                    };
                    const changeNode: HTMLLIElement = this.createNode(changeNodeOptions);
                    changesContainer.appendChild(changeNode);

                    const changeDetailsContainer: HTMLUListElement = this.createElement("ul");
                    changeNode.appendChild(changeDetailsContainer);

                    const start: Position = change.delete.start;
                    const end: Position = change.delete.end;
                    if (start.line !== end.line || start.character !== end.character) {
                        let delMsg: string = `Delete Ln ${start.line + 1}, Col ${start.character + 1}`;
                        if (start.line !== end.line) {
                            delMsg = `${delMsg} - Ln ${end.line + 1}, Col ${end.character + 1}`;
                        } else {
                            delMsg = delMsg + `-${end.character + 1}`;
                        }

                        const deleteNodeOptions: TreeNodeOptions = {
                            isParent: false,
                            locationText: "",
                            message: delMsg,
                            requestId: `${fixIndex}`,
                        };
                        changeDetailsContainer.appendChild(this.createNode(deleteNodeOptions));
                    }

                    if (change.insert !== undefined) {
                        const msg: string = `Insert at Ln ${start.line + 1}, Col ${start.character + 1}:` +
                            `"${change.insert}"`;
                        const insertNodeOptions: TreeNodeOptions = {
                            isParent: false,
                            locationText: "",
                            message: msg,
                            requestId: `${fixIndex}`,
                        };
                        changeDetailsContainer.appendChild(this.createNode(insertNodeOptions));
                    }
                }
            }
        }

        rootEle.addEventListener("click", this.onFixClicked.bind(this));
        panel.appendChild(rootEle);

        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the resultinfo tab
     * @param resultInfo Result info to create the tab content from
     */
    private createPanelResultInfo(resultInfo: ResultInfo): HTMLDivElement {
        const panel: HTMLDivElement = this.createPanel(tabNames.resultinfo);
        const tableEle: HTMLTableElement = this.createElement("table");

        if (resultInfo.ruleDescription) {
            const ruleDesc: Message = resultInfo.ruleDescription;
            if (ruleDesc.html !== undefined && ruleDesc.html !== resultInfo.message.html) {
                tableEle.appendChild(this.createNameValueRow("Rule Description:", ruleDesc.html, ruleDesc.text, true));
            }
        }

        const severity: TextAndTooltip = this.severityTextAndTooltip(resultInfo.severityLevel);
        tableEle.appendChild(this.createNameValueRow("Severity level:", severity.text, severity.tooltip));

        if (resultInfo.kind !== undefined) {
            const kind: TextAndTooltip = this.kindTextAndTooltip(resultInfo.kind);
            tableEle.appendChild(this.createNameValueRow("Kind:", kind.text, kind.tooltip));
        }

        if (resultInfo.rank !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Rank:", resultInfo.rank.toString(10)));
        }

        if (resultInfo.baselineState) {
            const baselineState: TextAndTooltip = this.baselineStateTextAndTooltip(resultInfo.baselineState);
            tableEle.appendChild(this.createNameValueRow("Baseline state:", baselineState.text, baselineState.tooltip));
        }

        if (resultInfo.ruleHelpUri !== undefined) {
            const cellContents: HTMLAnchorElement = this.createElement("a", { text: resultInfo.ruleHelpUri });
            cellContents.href = resultInfo.ruleHelpUri;
            tableEle.appendChild(this.createRowWithContents("Help: ", cellContents));
        }

        let row: HTMLTableRowElement | undefined = this.createLocationsRow("Locations: ", resultInfo.locations);
        if (row) {
            tableEle.appendChild(row);
        }

        row = this.createLogicalLocationsRow("Logical Locations: ", resultInfo.locations);
        if (row) {
            tableEle.appendChild(row);
        }

        row = this.createLocationsRow("Related: ", resultInfo.relatedLocs);
        if (row) {
            tableEle.appendChild(row);
        }

        row = this.createLogicalLocationsRow("Related Logical Locations: ", resultInfo.relatedLocs);
        if (row) {
            tableEle.appendChild(row);
        }

        if (resultInfo.additionalProperties) {
            tableEle.appendChild(this.createPropertiesRow(resultInfo.additionalProperties));
        }

        if (resultInfo.locationInSarifFile) {
            row = this.createLocationsRow("Location in Log: ", [resultInfo.locationInSarifFile]);
            if (row) {
                tableEle.appendChild(row);
            }
        }

        panel.appendChild(tableEle);

        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the runinfo tab
     * @param runInfo Run info to create the tab content from
     */
    private createPanelRunInfo(runInfo: RunInfo): HTMLDivElement {
        const panel: HTMLDivElement = this.createPanel(tabNames.runinfo);
        const tableEle: HTMLTableElement = document.createElement("table");

        if (runInfo.toolName !== undefined || runInfo.toolFullName !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Tool:", runInfo.toolFullName || runInfo.toolName));
        }

        if (runInfo.cmdLine !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Command line:", runInfo.cmdLine));
        }

        if (runInfo.toolFileName !== undefined) {
            tableEle.appendChild(this.createNameValueRow("File name:", runInfo.toolFileName));
        }
        if (runInfo.workingDir !== undefined) {

            tableEle.appendChild(this.createNameValueRow("Working directory:", runInfo.workingDir));
        }

        if (runInfo.startUtc !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Start Time:", new Date(runInfo.startUtc).toUTCString()));
        }

        if (runInfo.timeDuration !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Duration:", runInfo.timeDuration));
        }

        if (runInfo.automationCategory !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Automation Category:", runInfo.automationCategory));
        }

        if (runInfo.automationIdentifier !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Automation Identifier:", runInfo.automationIdentifier));
        }

        // The last item in the list should be properties if they exist
        if (runInfo.additionalProperties !== undefined) {
            tableEle.appendChild(this.createPropertiesRow(runInfo.additionalProperties));
        }

        panel.appendChild(tableEle);

        return panel;
    }

    /**
     * Creates a Panel that shows the Stacks of a result
     * @param stacks Array of Stack objects to create the panel with
     */
    private createPanelStacks(stacks: Stacks): HTMLDivElement {
        const panel: HTMLDivElement = this.createPanel(tabNames.stacks);
        if (stacks.stacks.length !== 0) {
            return panel;
        }

        const tableEle: HTMLTableElement = this.createElement("table",
            { id: "stackstable", className: "listtable" });

        const headerRow: HTMLTableRowElement = this.createElement("tr");
        let columnCount: number = 0;
        for (let index: number  = 0; index < stackHeaderNames.length; index++) {
            if (stacks.columnsWithContent[stackHeaderNames[index].headerType] === true) {
                const headerEle: HTMLTableHeaderCellElement = this.createElement("th", { text: stackHeaderNames[index].uiString });
                headerRow.appendChild(headerEle);
                columnCount++;
            }
        }
        const tableHeadEle: HTMLHeadElement = this.createElement("thead");
        tableHeadEle.appendChild(headerRow);
        tableEle.appendChild(tableHeadEle);

        const tableBodyEle: HTMLBodyElement = this.createElement("tbody");
        for (let stackIndex: number = 0; stackIndex < stacks.stacks.length; stackIndex++) {
            const stack: Stack = stacks.stacks[stackIndex];
            const msgRow: HTMLTableRowElement = this.createElement("tr", {
                attributes: { "data-group": stackIndex, "tabindex": "0" },
                className: `listtablegroup ${ToggleState.expanded}`,
            });
            msgRow.appendChild(this.createElement("th", {
                attributes: { colspan: `${columnCount}` },
                text: stack.message.text,
            }));
            msgRow.addEventListener("click", this.onToggleStackGroup.bind(this));
            tableBodyEle.appendChild(msgRow);

            const tdTag: string = "td";
            for (const frame of stack.frames) {
                const fLocation: Location = frame.location;
                let file: string | undefined;
                if (fLocation.uri) {
                    // @ts-ignore external exist on the webview side
                    file = fLocation.uri.external.replace("%3A", ":");
                }

                const fRow: HTMLTableRowElement = this.createElement("tr", {
                    attributes: {
                        "data-eCol": fLocation.range.end.character.toString(),
                        "data-eLine": fLocation.range.end.line.toString(),
                        "data-file": file,
                        "data-group": stackIndex,
                        "data-sCol": fLocation.range.start.character.toString(),
                        "data-sLine": fLocation.range.start.line.toString(),
                    },
                    className: "listtablerow",
                });

                if (file !== undefined) {
                    fRow.addEventListener("click", this.onSourceLinkClicked.bind(this));
                }

                const fLine: string = fLocation.range !== undefined ? fLocation.range.start.line.toString() : "";
                const fParameters: string = frame.parameters.toString();
                let fMsg: string = "";
                if (frame.message !== undefined && frame.message.text !== undefined) {
                    fMsg = frame.message.text;
                }

                let fThreadId: string = "";
                if (frame.threadId !== undefined) {
                    fThreadId = frame.threadId.toString();
                }

                fRow.appendChild(this.createElement(tdTag));
                if (stacks.columnsWithContent.message === true) {
                    fRow.appendChild(this.createElement(tdTag, { text: fMsg, tooltip: fMsg }));
                }
                if (stacks.columnsWithContent.name === true) {
                    fRow.appendChild(this.createElement(tdTag, { text: frame.name, tooltip: frame.name }));
                }
                if (stacks.columnsWithContent.location === true) {
                    fRow.appendChild(this.createElement(tdTag, { text: fLine, tooltip: fLine }));
                }
                if (stacks.columnsWithContent.filename === true) {
                    fRow.appendChild(this.createElement(tdTag,
                        { text: frame.location.fileName, tooltip: fLocation.fileName }));
                }
                if (stacks.columnsWithContent.parameters === true) {
                    fRow.appendChild(this.createElement(tdTag, { text: fParameters, tooltip: fParameters }));
                }
                if (stacks.columnsWithContent.threadId === true) {
                    fRow.appendChild(this.createElement(tdTag, { text: fThreadId, tooltip: fThreadId }));
                }

                tableBodyEle.appendChild(fRow);
            }
        }
        tableEle.appendChild(tableBodyEle);

        panel.appendChild(tableEle);

        return panel;
    }

    /**
     * Creates the properties content to show
     * @param properties the properties object that has the bag of additional properties
     */
    private createPropertiesRow(properties: { [key: string]: string }): HTMLTableRowElement {
        const cellContents: HTMLDivElement = this.createElement("div");
        for (const propName in properties) {
            if (properties.hasOwnProperty(propName)) {
                const propText: string = `${propName}: ${properties[propName]}`;
                cellContents.appendChild(this.createElement("label", { text: propText, tooltip: propText }));
                cellContents.appendChild(this.createElement("br"));
            }
        }

        return this.createRowWithContents("Properties: ", cellContents);
    }

    /**
     * Creates a row with an html element for it's value cell, useful for multiline values such as locations
     * @param rowName name to show up on the left side of the row
     * @param contents html element to add to the value cell
     */
    private createRowWithContents(rowName: string, contents: HTMLElement): HTMLTableRowElement {
        const row: HTMLTableRowElement = this.createElement("tr");
        row.appendChild(this.createElement("td", { className: "td-contentname", text: rowName }));
        const cell: HTMLTableDataCellElement = this.createElement("td", { className: "td-contentvalue" });
        cell.appendChild(contents);
        row.appendChild(cell);
        return row;
    }

    /**
     * Creates a html link element that when clicked will open the source in the VSCode Editor
     * @param location The location object that represents where the link points to
     * @param linkText The text to display on the link
     */
    private createSourceLink(location: Location, linkText: string): HTMLAnchorElement | undefined {
        let sourceLink: HTMLAnchorElement | undefined;
        if (location.uri && location.range) {
            // @ts-ignore external exist on the webview side
            const file: string = location.uri.external.replace("%3A", ":");
            sourceLink = this.createElement("a", {
                attributes: {
                    "data-eCol": location.range.end.character.toString(),
                    "data-eLine": location.range.end.line.toString(),
                    "data-file": file,
                    "data-sCol": location.range.start.character.toString(),
                    "data-sLine": location.range.start.line.toString(),
                    "href": "#0",
                }, className: "sourcelink", text: linkText, tooltip: file,
            }) as HTMLAnchorElement;

            sourceLink.addEventListener("click", this.onSourceLinkClicked.bind(this));
        }

        return sourceLink;
    }

    /**
     * Creates a tab to add to the tab container
     * @param tabId id of the tab
     * @param tabTooltip tooltip of the tab
     * @param tabText text that shows on the tab
     */
    private createTabElement(tabId: tabNames, tabTooltip: string, tabText: string): HTMLDivElement {
        const returnEle: HTMLDivElement = this.createElement("div",
            { className: "tab", id: tabId, tooltip: tabTooltip });
        returnEle.appendChild(this.createElement("label", { className: "tablabel", text: tabText }));
        returnEle.addEventListener("click", this.onTabClicked.bind(this));
        return returnEle;
    }

    /**
     * Creates the Tabs Container content, the tabs at the top of the tab container
     * @param hasCodeFlows Flag to include the CodeFlow tab in the set of tabs
     * @param hasAttachments Flag to include the Attachments tab in the set of tabs
     */
    private createTabHeaderContainer(): HTMLDivElement {
        const container: HTMLDivElement = this.createElement("div", { id: "tabcontainer" });

        container.appendChild(this.createTabElement(tabNames.resultinfo, "Results info", "RESULT INFO"));
        if (this.hasCodeFlows) {
            container.appendChild(this.createTabElement(tabNames.codeflow, "Code flow", "CODE FLOW"));
        }
        container.appendChild(this.createTabElement(tabNames.runinfo, "Run info", "RUN INFO"));
        if (this.hasAttachments) {
            container.appendChild(this.createTabElement(tabNames.attachments, "Attachments", "ATTACHMENTS"));
        }
        if (this.hasFixes) {
            container.appendChild(this.createTabElement(tabNames.fixes, "Fixes", "FIXES"));
        }
        if (this.hasStacks) {
            container.appendChild(this.createTabElement(tabNames.stacks, "Stacks", "STACKS"));
        }

        return container;
    }

    /**
     * Sets the open tab in the explorer, if no tab is passed in, defaults to codeflowtab or resultinfo
     * @param activeTab the active tab to set on the initialized state
     */
    private initializeOpenedTab(activeTab?: tabNames): void {
        let tab: tabNames | undefined = activeTab;
        if (tab === undefined) {
            if (this.hasCodeFlows) {
                tab = tabNames.codeflow;
            } else {
                tab = tabNames.resultinfo;
            }
        }

        this.openTab(tab);
    }

    /**
     * builds the result details section of the viewer, using the currently set diagnostic
     */
    private loadResultDetails(): void {
        if (!this.diagnostic) {
            return;
        }

        const resultInfo: ResultInfo = this.diagnostic.resultInfo;
        this.hasCodeFlows = resultInfo.codeFlows !== undefined && resultInfo.codeFlows.length > 0;
        this.hasAttachments = resultInfo.attachments !== undefined && resultInfo.attachments.length > 0;
        this.hasFixes = resultInfo.fixes !== undefined && resultInfo.fixes.length > 0;
        this.hasStacks = resultInfo.stacks !== undefined && resultInfo.stacks.stacks.length > 0;

        this.createResultDetailsHeader(resultInfo);

        const resultDetailsContainer: HTMLDivElement | null = <HTMLDivElement | null>document.getElementById("resultdetailscontainer");
        if (!resultDetailsContainer) {
            return;
        }

        const resultDetails: HTMLDivElement = this.createElement("div", { id: "resultdescription" });
        if (resultInfo.message.html !== undefined) {
            resultDetails.innerHTML = resultInfo.message.html;
        }

        resultDetailsContainer.appendChild(resultDetails);
        resultDetailsContainer.appendChild(this.createTabHeaderContainer());

        // Create and add the panels
        const panelContainer: HTMLDivElement = this.createElement("div", { id: "tabcontentcontainer" });
        panelContainer.appendChild(this.createPanelResultInfo(resultInfo));
        panelContainer.appendChild(this.createPanelCodeFlow(resultInfo.codeFlows));

        if (this.diagnostic.runInfo) {
            panelContainer.appendChild(this.createPanelRunInfo(this.diagnostic.runInfo));
        }

        panelContainer.appendChild(this.createPanelAttachments(resultInfo.attachments));
        panelContainer.appendChild(this.createPanelFixes(resultInfo.fixes));
        panelContainer.appendChild(this.createPanelStacks(resultInfo.stacks));
        resultDetailsContainer.appendChild(panelContainer);

        // Setup any state
        if (this.hasCodeFlows) {
            this.updateTreeVerbosity();
        }
        this.initializeOpenedTab(this.diagnostic.activeTab);
    }

    /**
     * Callback when user clicks on the Attachment tree
     * @param event event fired when user clicked the attachment tree
     */
    private onAttachmentClicked(event: MouseEvent): void {
        /**
         * For reference, the attachment structure looks like this.
         * <li class='unexpandable' id='xyz'> | <li class='expanded' id='xyz]>
         *    <span class="treenodeLocation"/>
         *    <span class="treenodeLine"/>
         * </li>
         * And the click handler is on the root "list" element. So we must handle
         * the clicks on all the element types.
         */
        const ele: HTMLElement = getElementFromEvent(event, HTMLElement);

        // If the clicked element is either one of the spans, then we need the parent list element.
        const elementOfInterest: HTMLElement | null = (ele.classList.contains("treenodelocation") || ele.classList.contains("treenodeline")) ? ele.parentElement : ele;
        if (!elementOfInterest) {
            return;
        }

        // If the list element is expandable and the click was in the right region (not sure why we aren't handling the arrow click itself)
        // The toggle the expansion state.
        if (!elementOfInterest.classList.contains("unexpandable") && event.offsetX < 17 /*width of the expand/collapse arrows*/) {
            this.toggleTreeElement(ele);
        } else {
            // Otherwise, send the attachment click back to the explorer controller.
            this.sendMessage({ data: ele.id, type: MessageType.AttachmentSelectionChange });
        }
    }

    /**
     * Callback when user clicks on the header, for showing and hiding the Results list or Results Details sections
     * @param event event fired when user clicked a header
     */
    public onHeaderClicked(event: MouseEvent): void {
        let ele: HTMLElement | null = <HTMLElement>event.srcElement;
        while (!ele.classList.contains("headercontainer")) {
            ele = ele.parentElement as HTMLElement;
        }

        let otherHeaderId: string = "resultslistheader";
        if (ele.id === "resultslistheader") {
            otherHeaderId = "resultdetailsheader";
        }

        const otherHeaderEle: Element | null = document.getElementById(otherHeaderId);
        if (ele.classList.contains(ToggleState.collapsed)) {
            ele.classList.replace(ToggleState.collapsed, ToggleState.expanded);

            if (otherHeaderEle) {
                otherHeaderEle.classList.replace(ToggleState.expanded, ToggleState.collapsed);
            }
        } else if (ele.classList.contains(ToggleState.expanded)) {
            ele.classList.replace(ToggleState.expanded, ToggleState.collapsed);
            if (otherHeaderEle) {
                otherHeaderEle.classList.replace(ToggleState.collapsed, ToggleState.expanded);
            }
        }

        const resultsListHeader: Element | null = document.getElementById("resultslistheader");
        if (resultsListHeader && resultsListHeader.classList.contains(ToggleState.expanded)) {
            const table: JQuery<HTMLElement> = $("#resultslisttable");
            // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
            table.colResizable({ disable: true });
            // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
            table.colResizable(this.resultsList.colResizeObj);
            window.dispatchEvent(new Event("resize"));
        }
    }

    /**
     * Callback when user clicks on the CodeFlow tree
     * @param event event fired when user clicked the codeflow tree
     */
    private onCodeFlowTreeClicked(event: MouseEvent): void {
        let ele: HTMLElement | null = <HTMLElement>event.srcElement;
        if (ele.classList.contains("treenodelocation")) {
            ele = ele.parentElement;
        }

        if (!ele) {
            return;
        }

        if (!ele.classList.contains("unexpandable") && event.offsetX < 17 /*width of expand/collapse arrows*/) {
            this.toggleTreeElement(ele);
        } else {
            this.selectCodeFlowNode(ele);
            this.sendMessage({ data: ele.id, type: MessageType.CodeFlowSelectionChange } as WebviewMessage);
        }
    }

    /**
     * Callback when the user clicks the Collapse all button
     * @param event event fired when user clicked Collapse all button
     */
    private onCollapseAllClicked(): void {
        this.toggleTreeElements(ToggleState.expanded, ToggleState.collapsed);
    }

    /**
     * Callback when the user clicks the Expand all button
     * @param event event fired when user clicked Expand all button
     */
    private onExpandAllClicked(): void {
        this.toggleTreeElements(ToggleState.collapsed, ToggleState.expanded);
    }

    /**
     * Callback when user clicks on the Fix tree
     * @param event event fired when user clicked the fix tree
     */
    private onFixClicked(event: MouseEvent): void {
        const ele: HTMLSpanElement = getElementFromEvent(event, HTMLSpanElement);
        if (ele.classList.contains("treenodelocation") || ele.classList.contains("treenodeline")) {
            const parentElement: HTMLElement | null = ele.parentElement;
            if (parentElement && parentElement.classList.contains("unexpandable") && event.offsetX < 17/*width of the expand/collapse arrows*/) {
                this.toggleTreeElement(parentElement);
            }
        }
    }

    /**
     * Callback when a source link is clicked, sends the call back to the extension to handle opening the source file
     * @param event event fired when a sourcelink was clicked
     */
    private onSourceLinkClicked(event: MouseEvent): void {
        const ele: HTMLAnchorElement = getElementFromEvent(event, HTMLAnchorElement);
        if (ele.dataset.ecol === undefined ||
            ele.dataset.eline === undefined ||
            ele.dataset.file === undefined ||
            ele.dataset.scol === undefined ||
            ele.dataset.sline === undefined) {
            throw new Error("Source file information is not correct");
        }

        const msgData: LocationData = {
            eCol: ele.dataset.ecol,
            eLine: ele.dataset.eline,
            file: ele.dataset.file,
            sCol: ele.dataset.scol,
            sLine: ele.dataset.sline
        };

        this.sendMessage({ data: JSON.stringify(msgData), type: MessageType.SourceLinkClicked });
    }

    /**
     * Callback when a tab(Result Info, Code Flow, etc.) is clicked
     * @param event event fired when user clicked a tab
     */
    private onTabClicked(event: MouseEvent): void {
        // @ts-ignore: id does exist on the currentTarget property
        this.openTab(event.currentTarget.id);
    }

    /**
     * Toggles the group row as well as any stacks list rows that match the group
     * @param row Group row to toggled
     */
    private onToggleStackGroup(event: Event): void {
        const row: HTMLTableRowElement = <HTMLTableRowElement>event.currentTarget;
        let hideRow: boolean = false;
        if (row.classList.contains(`${ToggleState.expanded}`)) {
            row.classList.replace(`${ToggleState.expanded}`, `${ToggleState.collapsed}`);
            hideRow = true;
        } else {
            row.classList.replace(`${ToggleState.collapsed}`, `${ToggleState.expanded}`);
        }

        const results: NodeListOf<Element> = document.querySelectorAll("#stackstable > tbody > .listtablerow");

        // @ts-ignore: compiler complains even though results can be iterated
        for (const result of results) {
            // @ts-ignore: compiler complains even though results have a dataset
            if (result.dataset.group === row.dataset.group) {
                if (hideRow) {
                    result.classList.add("hidden");
                } else {
                    result.classList.remove("hidden");
                }
            }
        }
    }

    /**
     * Callback when the verbosity setting is changed
     * @param event event fired when user changed the verbosity setting
     */
    private onVerbosityChange(event: Event): void {
        this.updateTreeVerbosity();
    }

    /**
     * This method will remove the tabactive and tabcontentactive from the current active tab
     * And add it to the tab that was clicked
     * @param id id of the tab that was clicked
     */
    private openTab(id: string): void {
        const activeTabs: HTMLCollectionOf<Element>  = document.getElementsByClassName("tab tabactive");

        if (activeTabs.length >= 0) {
            for (let activeTabIndex: number = 0; activeTabIndex < activeTabs.length; activeTabIndex++) {
                const activeTab: Element | null  = activeTabs.item(activeTabIndex);
                if (activeTab) {
                    activeTab.classList.remove("tabactive");
                    const activeTablContet: Element | null = document.getElementById(activeTab.id + "content");
                    if (activeTablContet) {
                        activeTablContet.classList.remove("tabcontentactive");
                    }
                }
            }
        }

        const tabToActivate: Element | null = document.getElementById(id);
        if (tabToActivate) {
            tabToActivate.classList.add("tabactive");
            const activeTablContet: Element | null = document.getElementById(tabToActivate.id + "content");
            if (activeTablContet) {
                activeTablContet.classList.add("tabcontentactive");
            }
        }

        if (id === tabNames.stacks) {
            const table: JQuery<HTMLElement> | null = $("#stackstable");
            if (table) {
                // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
                table.colResizable({ disable: true });
                // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
                table.colResizable({
                    disabledColumns: [0], headerOnly: true, liveDrag: true,
                    minWidth: 26, partialRefresh: true, postbackSafe: true,
                });
                window.dispatchEvent(new Event("resize"));
            }
        }

        this.sendMessage({ data: id, type: MessageType.TabChanged } as WebviewMessage);
    }

    /**
     * Selects the codeflow node, includes unselecting any already selected codeflow nodes
     * @param ele the codeflow node element to select
     */
    private selectCodeFlowNode(ele: HTMLElement): void {
        const codeFlowSelectedClass: string = "codeflowselected";
        const cfSelected: HTMLCollectionOf<Element> = document.getElementsByClassName(codeFlowSelectedClass);
        while (cfSelected.length > 0) {
            cfSelected[0].classList.remove(codeFlowSelectedClass);
        }
        ele.classList.add(codeFlowSelectedClass);
    }

    /**
     * Sets the diagnostic to display the info. Also sets the default values if they exist in the data parameter
     * @param data json stringify'd version of the diagnosticdata to be set
     */
    private setDiagnostic(data: string): void {
        this.cleanUpResultDetails();

        // Zero-length data string means no activate diagnostic
        const newDiagnosticData: DiagnosticData | undefined = data.length !== 0 ? JSON.parse(data) : undefined;
        this.diagnostic = newDiagnosticData;

        if (!newDiagnosticData) {
            return;
        }

        this.loadResultDetails();

        if (newDiagnosticData.selectedRow !== undefined) {
            this.showTreeNode(newDiagnosticData.selectedRow, true);
        }

        if (newDiagnosticData.activeTab !== undefined) {
            this.openTab(newDiagnosticData.activeTab);
        }

        if (newDiagnosticData.selectedVerbosity !== undefined) {
            const codeflowverbosity: HTMLInputElement | undefined = getOptionalDocumentElementById(document, "codeflowverbosity", HTMLInputElement);
            if (codeflowverbosity) {
                codeflowverbosity.value = newDiagnosticData.selectedVerbosity;
                this.updateTreeVerbosity();
            }
        }
    }

    /**
     * Sets the verbosity show state for each tree node that matches the passed in type
     * @param type type of the tree node("important" or "unimportant")
     * @param state verbosity show state to set the matching nodes to ("verbosityshow" or "verbosityhide")
     */
    private setVerbosityShowState(type: string, state: string): void {
        const elements: HTMLCollectionOf<Element> = document.getElementsByClassName(type);
        for (let i: number = 0; i < elements.length; i++) {
            const verbosityElement: Element | null = elements.item(i);
            if (!verbosityElement) {
                continue;
            }

            const classes: string[] = verbosityElement.className.split(" ");
            classes[TreeClassNames.VerbosityShowState] = state;
            verbosityElement.className = classes.join(" ");
        }
    }

    /**
     * Gets the text and tooltip(a reduced version of the specs description) based on the result's kind
     * @param kind the results kind
     */
    public kindTextAndTooltip(kind: sarif.Result.kind): TextAndTooltip {
        return { text: kind || "", tooltip: KindTooltip[kind] || "" };
    }

    /**
     * Gets the text and tooltip(from the specs description) based on the result's baselineState
     * @param baselineState the results severity level
     */
    public baselineStateTextAndTooltip(baselineState: sarif.Result.baselineState): TextAndTooltip {
        return { text: baselineState || "", tooltip: BaselineStateTooltip[baselineState] || "" };
    }

    /**
     * Gets the text and tooltip(a reduced version of the specs description) based on the result's severity level
     * @param severity the results severity level
     */
    public severityTextAndTooltip(severity: sarif.Result.level): TextAndTooltip {
        return { text: severity || "", tooltip: SeverityTooltip[severity] || "" };
    }

    /**
     * find the matching tree node and expands it's parents, if select is true the node gets selected
     * @param treeNodeId the id of the tree node to show
     * @param select flag if true the tree node will be selected after it's parents are expanded
     */
    private showTreeNode(treeNodeId: string, select: boolean): void {
        const node: HTMLElement | null = document.getElementById(treeNodeId);
        if (!node) {
            return;
        }

        let parent: HTMLElement | null = node.parentElement;
        while (parent && parent.classList.contains("codeflowtreeroot")) {
            parent.classList.replace(ToggleState.collapsed, ToggleState.expanded);
            parent = parent.parentElement;
        }

        if (select) {
            this.selectCodeFlowNode(node);
            node.focus();
        }
    }

    /**
     * Toggles an element to the passed in state, or the opposite of it's current if no state is passed in
     * @param ele element that needs to toggle
     * @param toggleToState state to toggle it to, if not defined it will determine it based on the current state
     */
    private toggleTreeElement(ele: HTMLElement, toggleToState?: ToggleState): void {
        const classNames: string[] = ele.className.split(" ");
        if (toggleToState === undefined) {
            if (classNames[TreeClassNames.ExpandState] === ToggleState.expanded) {
                toggleToState = ToggleState.collapsed;
            } else {
                toggleToState = ToggleState.expanded;
            }
        }

        classNames[TreeClassNames.ExpandState] = toggleToState;
        ele.className = classNames.join(" ");
    }

    /**
     * Finds all of the elements in the trees that match the stateToToggle and changes it to the toggleToState
     * @param stateToToggle which state needs to be toggled
     * @param toggleToState which state elements will be toggled to
     */
    private toggleTreeElements(stateToToggle: ToggleState, toggleToState: ToggleState): void {
        const treeroots: HTMLCollectionOf<Element> = document.getElementsByClassName("codeflowtreeroot");
        for (let i: number = 0; i < treeroots.length; i++) {
            const treeRootElement: Element | null = treeroots.item(i);
            if (!treeRootElement) {
                continue;
            }

            const elements: HTMLCollectionOf<Element> = treeRootElement.getElementsByClassName(stateToToggle);
            while (elements.length > 0) {
                this.toggleTreeElement(<HTMLElement>elements[0], toggleToState);
            }
        }
    }

    /**
     * Updates the CodeFlow trees to only show the nodes based on the current verbosity setting
     */
    private updateTreeVerbosity(): void {
        const verbosityElement: HTMLInputElement = getDocumentElementById(document, "codeflowverbosity", HTMLInputElement);

        const verbosity: VerbosityState | undefined = verbosityLevels.get(verbosityElement.value);
        if (!verbosity) {
            throw new Error("Unhandled value for code flow verbosity.");
        }

        this.setVerbosityShowState("important", verbosity.importantClass);
        this.setVerbosityShowState("unimportant", verbosity.unimportantClass);

        this.sendMessage({ data: verbosity.verbosityRequest, type: MessageType.VerbosityChanged });
    }

}

let explorerWebview: ExplorerWebview | undefined;

export function startExplorer(): void {
    if (!explorerWebview) {
        explorerWebview = new ExplorerWebview();
        explorerWebview.sendMessage({ data: "", type: MessageType.ExplorerLoaded });
    }
}
