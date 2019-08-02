// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
/// <reference path="./enums.ts" />
import * as sarif from "sarif";
import { Position } from "vscode";
import {
    Attachment, CodeFlow, CodeFlowStep, DiagnosticData, Fix, HTMLElementOptions, Location, LocationData, Message,
    ResultInfo, ResultsListData, RunInfo, Stack, Stacks, TreeNodeOptions, WebviewMessage,
} from "../common/Interfaces";

/**
 * This class handles generating and providing the HTML content for the Explorer panel
 */
class ExplorerWebview {
    private diagnostic: DiagnosticData;
    private hasCodeFlows: boolean;
    private hasAttachments: boolean;
    private hasFixes: boolean;
    private hasStacks: boolean;
    private onAttachmentClickedBind;
    private onCodeFlowTreeClickedBind;
    private onCollapseAllClickedBind;
    private onExpandAllClickedBind;
    private onFixClickedBind;
    private onHeaderClickedBind;
    private onMessageBind;
    private onSourceLinkClickedBind;
    private onTabClickedBind;
    private onToggleStackGroupBind;
    private onVerbosityChangeBind;
    private vscode;
    private resultsList;

    public constructor() {
        this.onAttachmentClickedBind = this.onAttachmentClicked.bind(this);
        this.onCodeFlowTreeClickedBind = this.onCodeFlowTreeClicked.bind(this);
        this.onCollapseAllClickedBind = this.onCollapseAllClicked.bind(this);
        this.onExpandAllClickedBind = this.onExpandAllClicked.bind(this);
        this.onFixClickedBind = this.onFixClicked.bind(this);
        this.onHeaderClickedBind = this.onHeaderClicked.bind(this);
        this.onMessageBind = this.onMessage.bind(this);
        this.onSourceLinkClickedBind = this.onSourceLinkClicked.bind(this);
        this.onToggleStackGroupBind = this.onToggleStackGroup.bind(this);
        this.onTabClickedBind = this.onTabClicked.bind(this);
        this.onVerbosityChangeBind = this.onVerbosityChange.bind(this);

        // @ts-ignore ResultsList is a defined class but can't import becuase it's not a module
        this.resultsList = new ResultsList(this);

        window.addEventListener("message", this.onMessageBind);
        // @ts-ignore: acquireVsCodeApi function is provided real time in the webview
        this.vscode = acquireVsCodeApi();
    }

    /**
     * Called when the extension sends a message to the webview, this handles reacting to the message
     * @param event event sent from the extension, that has the WebviewMessage in it's data property
     */
    public onMessage(event: any) {
        const message = event.data as WebviewMessage;
        switch (message.type) {
            case MessageType.NewDiagnostic:
                this.setDiagnostic(message.data);
                this.resultsList.updateSelection();
                break;
            case MessageType.CodeFlowSelectionChange:
                this.showTreeNode(message.data, true);
                break;
            case MessageType.ResultsListDataSet:
                this.resultsList.Data = JSON.parse(message.data) as ResultsListData;
                break;
        }
    }

    /**
     * handles sending the webviewmessage to the extension
     * @param message message to send to the extension
     */
    public sendMessage(message: WebviewMessage) {
        this.vscode.postMessage(message);
    }

    /**
     * Helper function for creating an element and setting some of it's properties
     * @param tagName Type of element to create(div, label, etc.)
     * @param options Additional properties to set on the new element
     */
    public createElement(tagName: string, options?: HTMLElementOptions): HTMLElement {
        const ele = document.createElement(tagName);
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
    private addNodes(parent: HTMLUListElement, steps: CodeFlowStep[], start: number): number {
        for (let index = start; index < steps.length; index++) {
            const node = this.createCodeFlowNode(steps[index]);
            parent.appendChild(node);
            if (index < 0 || steps[index].isParent) {
                index++;
                const childrenContainer = this.createElement("ul") as HTMLUListElement;
                index = this.addNodes(childrenContainer, steps, index);
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
    private cleanUpResultDetails() {
        // Remove event handlers
        const tabContainer = document.getElementById("tabcontainer");
        if (tabContainer !== null) {
            for (let i = 0; i < tabContainer.children.length; i++) {
                tabContainer.children.item(i).removeEventListener("click", this.onTabClickedBind);
            }
        }

        const sourceLinks = document.getElementsByClassName("sourcelink");
        for (let i = 0; i < sourceLinks.length; i++) {
            sourceLinks.item(i).removeEventListener("click", this.onSourceLinkClickedBind);
        }

        if (this.hasCodeFlows) {
            const codeFlowTrees = document.getElementsByClassName("codeflowtreeroot");
            for (let i = 0; i < codeFlowTrees.length; i++) {
                codeFlowTrees.item(i).removeEventListener("click", this.onCodeFlowTreeClickedBind);
            }

            let element = document.getElementById("expandallcodeflow");
            if (element !== null) {
                element.removeEventListener("click", this.onExpandAllClickedBind);
            }

            element = document.getElementById("collapseallcodeflow");
            if (element !== null) {
                element.removeEventListener("click", this.onCollapseAllClickedBind);
            }

            element = document.getElementById("codeflowverbosity");
            if (element !== null) {
                element.removeEventListener("click", this.onVerbosityChangeBind);
            }
        }

        if (this.hasAttachments) {
            const attachmentTrees = document.getElementsByClassName("attachmentstreeroot");
            for (let i = 0; i < attachmentTrees.length; i++) {
                attachmentTrees.item(i).removeEventListener("click", this.onAttachmentClicked);
            }
        }

        // Clear Result Details
        const header = document.getElementById("resultdetailsheader");
        while (header.children.length > 0) {
            header.removeChild(header.children.item(0));
        }

        const container = document.getElementById("resultdetailscontainer");
        while (container.children.length > 0) {
            container.removeChild(container.children.item(0));
        }
    }

    /**
     * Creates a tree node for a codeflow step
     * @param step CodeFlow step to crete a node for
     */
    private createCodeFlowNode(step: CodeFlowStep): HTMLLIElement {
        let treeNodeOptions: TreeNodeOptions;
        if (step !== undefined) {
            const nodeClass = `${step.importance || "important"} verbosityshow`;
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
        const container = this.createElement("div", { id: "codeflowtreecontainer" }) as HTMLDivElement;

        for (const codeflow of codeflows) {
            const rootEle = this.createElement("ul", { className: "codeflowtreeroot" }) as HTMLUListElement;
            const thread = codeflow.threads[0];
            this.addNodes(rootEle, thread.steps, 0 - thread.lvlsFirstStepIsNested);
            rootEle.addEventListener("click", this.onCodeFlowTreeClickedBind);
            container.appendChild(rootEle);
        }

        return container;
    }

    /**
     * Creates the content that shows in the results details header of the Explorer window
     */
    private createResultDetailsHeader(resultInfo: ResultInfo) {
        const header = document.getElementById("resultdetailsheader");

        if (resultInfo.ruleId !== undefined || resultInfo.ruleName !== undefined) {
            header.appendChild(this.createElement("label", { id: "titleruleid", text: resultInfo.ruleId }));
            header.appendChild(this.createElement("label", { id: "titlerulename", text: resultInfo.ruleName }));
        } else {
            const severity = this.severityTextAndTooltip(resultInfo.severityLevel);
            header.appendChild(this.createElement("label", { id: "titlerulename", text: severity.text }));
        }
        header.appendChild(this.createElement("label", { text: " | " }));

        let filenameandline = "No Location";
        const resultLocation = resultInfo.locations[0];
        if (resultLocation !== null && resultLocation !== undefined) {
            if (resultLocation.uri !== undefined) {
                filenameandline = `${resultLocation.fileName} (${resultLocation.range[0].line + 1/*Convert 0 based*/})`;
            } else if (resultLocation.logicalLocations !== undefined && resultLocation.logicalLocations.length > 0) {
                filenameandline = resultLocation.logicalLocations[0];
            }
        }

        header.appendChild(this.createElement("label", { text: filenameandline }));
        header.addEventListener("click", this.onHeaderClickedBind);
    }

    /**
     * Creates a row with location links, returns undefined if no locations are displayable
     * @param rowName name to show up on the left side of the row
     * @param locations Array of Locations to be added to the Html
     */
    private createLocationsRow(rowName: string, locations: Location[]): HTMLTableRowElement {
        const cellContents = this.createElement("div") as HTMLDivElement;

        let locationsAdded = 0;
        for (const loc of locations) {
            if (loc !== undefined && loc !== null) {
                const text = `${loc.fileName} (${(loc.range[0].line + 1)})`;
                const link = this.createSourceLink(loc, text);
                if (link !== undefined) {
                    cellContents.appendChild(link);
                    cellContents.appendChild(this.createElement("br"));
                    locationsAdded++;
                }
            }
        }

        if (locationsAdded === 0) {
            return undefined;
        }

        return this.createRowWithContents(rowName, cellContents);
    }

    /**
     * Creates a row with logical locations, returns undefined if no logical locations are displayable
     * @param rowName name to show up on the left side of the row
     * @param locations Array of Locations to be added to the Html
     */
    private createLogicalLocationsRow(rowName: string, locations: Location[]): HTMLTableRowElement {
        const cellContents = this.createElement("div") as HTMLDivElement;

        let locationsAdded = 0;
        for (const loc of locations) {
            if (loc !== undefined && loc !== null) {
                if (loc.logicalLocations !== undefined) {
                    for (const logLoc of loc.logicalLocations) {
                        const text = this.createElement("span", { text: logLoc });
                        cellContents.appendChild(text);
                        cellContents.appendChild(this.createElement("br"));
                        locationsAdded++;
                    }
                }
            }
        }

        if (locationsAdded === 0) {
            return undefined;
        }

        return this.createRowWithContents(rowName, cellContents);
    }

    /**
     * Helper function creates a simple two row column with the name on the left and value on the right
     * For more complex values(not string) you'll need to manually create the element
     * @param name value in the left column
     * @param value value in the right column
     * @param valueTooltip tooltip to show over the value in right column
     * @param isHtml flag to set if the @param value is html so it gets set via innerHtml *note* only set on safe values
     */
    private createNameValueRow(name: string, value: string, valueTooltip?: string, isHtml?: boolean) {
        const row = this.createElement("tr") as HTMLTableRowElement;
        row.appendChild(this.createElement("td", { className: "td-contentname", text: name }));
        if (valueTooltip === undefined) { valueTooltip = value; }
        if (isHtml === true) {
            const cont = this.createElement("td", { className: "td-contentvalue", tooltip: valueTooltip });
            cont.innerHTML = value;
            row.appendChild(cont);
        } else {
            const cont = this.createElement("td", { className: "td-contentvalue", text: value, tooltip: valueTooltip });
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
                const optLogLocs = options.location.logicalLocations;
                if (optLogLocs !== undefined && optLogLocs.length > 0) {
                    options.logicalLocation = optLogLocs[0];
                }
            }

            if (options.locationText === undefined) {
                options.locationText = options.location.fileName;
            }

            if (options.locationText !== undefined && options.locationLine === undefined) {
                const locRange = options.location.range[0];
                options.locationLine = `(${locRange.line + 1},${locRange.character + 1})`;
            }

            if (options.message === undefined) {
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

        const node = this.createElement("li", {
            attributes: { tabindex: "0" }, className: options.liClass, id: options.requestId, tooltip: options.tooltip,
        }) as HTMLLIElement;

        const locationTooltip = options.locationText + options.locationLine;
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
        const panel = this.createPanel(tabNames.attachments);

        if (attachments !== undefined) {
            const rootEle = this.createElement("ul", { className: "attachmentstreeroot" }) as HTMLUListElement;
            for (const aIndex of attachments.keys()) {
                let isAParent = false;
                const attachment = attachments[aIndex];
                if (attachment.regionsOfInterest !== undefined) { isAParent = true; }
                let treeNodeOptions = {
                    isParent: isAParent,
                    location: attachment.file,
                    message: attachment.description.text,
                    requestId: `${aIndex}`,
                } as TreeNodeOptions;
                const parent = this.createNode(treeNodeOptions);
                if (isAParent) {
                    const childrenContainer = this.createElement("ul") as HTMLUListElement;
                    for (const rIndex of attachment.regionsOfInterest.keys()) {
                        const region = attachment.regionsOfInterest[rIndex];
                        treeNodeOptions = {
                            isParent: false,
                            locationText: "",
                            message: region.message.text,
                            requestId: `${aIndex}_${rIndex}`,
                        } as TreeNodeOptions;

                        childrenContainer.appendChild(this.createNode(treeNodeOptions));
                    }

                    parent.appendChild(childrenContainer);
                }
                rootEle.appendChild(parent);
            }

            rootEle.addEventListener("click", this.onAttachmentClickedBind);
            panel.appendChild(rootEle);
        }
        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the Code Flow tab
     * @param codeFlows Array of code flows to create the content from
     */
    private createPanelCodeFlow(codeFlows: CodeFlow[]): HTMLDivElement {
        const panel = this.createPanel(tabNames.codeflow);
        if (codeFlows !== undefined) {
            const headerEle = this.createElement("div", { className: "tabcontentheader" }) as HTMLDivElement;

            const expandAll = this.createElement("div", {
                className: "tabcontentheaderbutton", id: "expandallcodeflow", text: "+", tooltip: "Expand All",
            });
            expandAll.addEventListener("click", this.onExpandAllClickedBind);
            headerEle.appendChild(expandAll);

            const collapseAll = this.createElement("div", {
                className: "tabcontentheaderbutton", id: "collapseallcodeflow", text: "-", tooltip: "Collapse All",
            });
            collapseAll.addEventListener("click", this.onCollapseAllClickedBind);
            headerEle.appendChild(collapseAll);

            headerEle.appendChild(this.createElement("div", { className: "headercontentseperator", text: "|" }));

            const verbosity = this.createElement("input", {
                attributes: { max: "2", type: "range" }, id: "codeflowverbosity", tooltip: "Tree Verbosity",
            });
            verbosity.addEventListener("change", this.onVerbosityChangeBind);
            headerEle.appendChild(verbosity);
            panel.appendChild(headerEle);

            panel.appendChild(this.createCodeFlowTrees(codeFlows));
        }

        return panel;
    }

    /**
     * Creates a Panel that shows the Fixes of a result
     * @param fixes Array of Fixes objects to create the panel with
     */
    private createPanelFixes(fixes: Fix[]): HTMLDivElement {
        const panel = this.createPanel(tabNames.fixes);

        if (fixes !== undefined) {
            const rootEle = this.createElement("ul", { className: "fixestreeroot" }) as HTMLUListElement;
            for (const index of fixes.keys()) {
                const fix = fixes[index];
                const hasFiles = fix.files !== undefined && fix.files.length > 0;
                const fixRootNodeOptions = {
                    isParent: hasFiles,
                    locationText: "",
                    message: fix.description.text,
                    requestId: `${index}`,
                } as TreeNodeOptions;
                const fixRootNode = this.createNode(fixRootNodeOptions);
                rootEle.appendChild(fixRootNode);

                if (hasFiles) {
                    const filesContainer = this.createElement("ul") as HTMLUListElement;
                    fixRootNode.appendChild(filesContainer);
                    for (const filesIndex of fix.files.keys()) {
                        const file = fix.files[filesIndex];
                        const hasChanges = file.changes !== undefined && file.changes.length > 0;
                        const fileNodeOptions = {
                            isParent: true, locationText: "", message: file.location.fileName,
                            requestId: `${index}`, tooltip: file.location.uri.fsPath,
                        } as TreeNodeOptions;
                        const fileNode = this.createNode(fileNodeOptions);
                        filesContainer.appendChild(fileNode);

                        if (hasChanges) {
                            const changesContainer = this.createElement("ul") as HTMLUListElement;
                            fileNode.appendChild(changesContainer);
                            for (const changeIndex of file.changes.keys()) {
                                const change = file.changes[changeIndex];
                                const changeMsg = `Change ${changeIndex + 1}`;
                                const changeNodeOptions = {
                                    isParent: true,
                                    locationText: "",
                                    message: changeMsg,
                                    requestId: `${index}`,
                                } as TreeNodeOptions;
                                const changeNode = this.createNode(changeNodeOptions);
                                changesContainer.appendChild(changeNode);

                                const changeDetailsContainer = this.createElement("ul") as HTMLUListElement;
                                changeNode.appendChild(changeDetailsContainer);

                                const start = change.delete[0] as Position;
                                const end = change.delete[1] as Position;
                                if (start.line !== end.line || start.character !== end.character) {
                                    let delMsg = `Delete Ln ${start.line + 1}, Col ${start.character + 1}`;
                                    if (start.line !== end.line) {
                                        delMsg = `${delMsg} - Ln ${end.line + 1}, Col ${end.character + 1}`;
                                    } else {
                                        delMsg = delMsg + `-${end.character + 1}`;
                                    }

                                    const deleteNodeOptions = {
                                        isParent: false,
                                        locationText: "",
                                        message: delMsg,
                                        requestId: `${index}`,
                                    } as TreeNodeOptions;
                                    changeDetailsContainer.appendChild(this.createNode(deleteNodeOptions));
                                }

                                if (change.insert !== undefined) {
                                    const msg = `Insert at Ln ${start.line + 1}, Col ${start.character + 1}:` +
                                        `"${change.insert}"`;
                                    const insertNodeOptions = {
                                        isParent: false,
                                        locationText: "",
                                        message: msg,
                                        requestId: `${index}`,
                                    } as TreeNodeOptions;
                                    changeDetailsContainer.appendChild(this.createNode(insertNodeOptions));
                                }
                            }
                        }
                    }
                }
            }

            rootEle.addEventListener("click", this.onFixClickedBind);
            panel.appendChild(rootEle);
        }
        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the resultinfo tab
     * @param resultInfo Result info to create the tab content from
     */
    private createPanelResultInfo(resultInfo: ResultInfo): HTMLDivElement {
        const panel = this.createPanel(tabNames.resultinfo);
        const tableEle = this.createElement("table") as HTMLTableElement;

        if (resultInfo.ruleDescription !== undefined) {
            const ruleDesc = resultInfo.ruleDescription;
            if (ruleDesc.html !== undefined && ruleDesc.html !== resultInfo.message.html) {
                tableEle.appendChild(this.createNameValueRow("Rule Description:", ruleDesc.html, ruleDesc.text, true));
            }
        }

        const severity = this.severityTextAndTooltip(resultInfo.severityLevel);
        tableEle.appendChild(this.createNameValueRow("Severity level:", severity.text, severity.tooltip));

        if (resultInfo.kind !== undefined) {
            const kind = this.kindTextAndTooltip(resultInfo.kind);
            tableEle.appendChild(this.createNameValueRow("Kind:", kind.text, kind.tooltip));
        }

        if (resultInfo.rank !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Rank:", resultInfo.rank.toString(10)));
        }

        if (resultInfo.baselineState !== undefined) {
            const baselineState = this.baselineStateTextAndTooltip(resultInfo.baselineState);
            tableEle.appendChild(this.createNameValueRow("Baseline state:", baselineState.text, baselineState.tooltip));
        }

        if (resultInfo.ruleHelpUri !== undefined) {
            const cellContents = this.createElement("a", { text: resultInfo.ruleHelpUri }) as HTMLAnchorElement;
            cellContents.href = resultInfo.ruleHelpUri;
            tableEle.appendChild(this.createRowWithContents("Help: ", cellContents));
        }

        let row = this.createLocationsRow("Locations: ", resultInfo.locations);
        if (row !== undefined) {
            tableEle.appendChild(row);
        }

        row = this.createLogicalLocationsRow("Logical Locations: ", resultInfo.locations);
        if (row !== undefined) {
            tableEle.appendChild(row);
        }

        row = this.createLocationsRow("Related: ", resultInfo.relatedLocs);
        if (row !== undefined) {
            tableEle.appendChild(row);
        }

        row = this.createLogicalLocationsRow("Related Logical Locations: ", resultInfo.relatedLocs);
        if (row !== undefined) {
            tableEle.appendChild(row);
        }

        if (resultInfo.additionalProperties !== undefined) {
            tableEle.appendChild(this.createPropertiesRow(resultInfo.additionalProperties));
        }

        row = this.createLocationsRow("Location in Log: ", [resultInfo.locationInSarifFile]);
        if (row !== undefined) {
            tableEle.appendChild(row);
        }

        panel.appendChild(tableEle);

        return panel;
    }

    /**
     * Creates the content that shows when the user clicks the runinfo tab
     * @param runInfo Run info to create the tab content from
     */
    private createPanelRunInfo(runInfo: RunInfo): HTMLDivElement {
        const panel = this.createPanel(tabNames.runinfo);
        const tableEle = this.createElement("table") as HTMLTableElement;

        if (runInfo.toolName !== undefined) {
            tableEle.appendChild(this.createNameValueRow("Tool:", runInfo.toolFullName));
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
        const panel = this.createPanel(tabNames.stacks);
        if (stacks !== undefined) {
            const tableEle = this.createElement("table",
                { id: "stackstable", className: "listtable" }) as HTMLTableElement;

            const headerNames = ["", "Message", "Name", "Line", "File", "Parameters", "ThreadId"];
            const headerRow = this.createElement("tr") as HTMLTableRowElement;
            let columnCount = 0;
            for (let index = 0; index < headerNames.length; index++) {
                if (stacks.columnsWithContent[index] === true) {
                    const headerEle = this.createElement("th", { text: headerNames[index] });
                    headerRow.appendChild(headerEle);
                    columnCount++;
                }
            }
            const tableHeadEle = this.createElement("thead") as HTMLHeadElement;
            tableHeadEle.appendChild(headerRow);
            tableEle.appendChild(tableHeadEle);

            const tableBodyEle = this.createElement("tbody") as HTMLBodyElement;
            for (let stackIndex = 0; stackIndex < stacks.stacks.length; stackIndex++) {
                const stack = stacks.stacks[stackIndex];
                const msgRow = this.createElement("tr", {
                    attributes: { "data-group": stackIndex, "tabindex": "0" },
                    className: `listtablegroup ${ToggleState.expanded}`,
                });
                msgRow.appendChild(this.createElement("th", {
                    attributes: { colspan: `${columnCount}` },
                    text: stack.message.text,
                }));
                msgRow.addEventListener("click", this.onToggleStackGroupBind);
                tableBodyEle.appendChild(msgRow);

                const tdTag = "td";
                for (const frame of stack.frames) {
                    const fLocation = frame.location;
                    let file: string;
                    if (fLocation.uri !== undefined) {
                        // @ts-ignore external exist on the webview side
                        file = fLocation.uri.external.replace("%3A", ":");
                    }

                    const fRow = this.createElement("tr", {
                        attributes: {
                            "data-eCol": fLocation.range[1].character.toString(),
                            "data-eLine": fLocation.range[1].line.toString(),
                            "data-file": file,
                            "data-group": stackIndex,
                            "data-sCol": fLocation.range[0].character.toString(),
                            "data-sLine": fLocation.range[0].line.toString(),
                        },
                        className: "listtablerow",
                    });

                    if (file !== undefined) {
                        fRow.addEventListener("click", this.onSourceLinkClickedBind);
                    }

                    const fLine = fLocation.range[0].line.toString();
                    const fParameters = frame.parameters.toString();
                    let fMsg = "";
                    if (frame.message !== undefined && frame.message.text !== undefined) {
                        fMsg = frame.message.text;
                    }

                    let fThreadId = "";
                    if (frame.threadId !== undefined) {
                        fThreadId = frame.threadId.toString();
                    }

                    fRow.appendChild(this.createElement(tdTag));
                    if (stacks.columnsWithContent[1] === true) {
                        fRow.appendChild(this.createElement(tdTag, { text: fMsg, tooltip: fMsg }));
                    }
                    if (stacks.columnsWithContent[2] === true) {
                        fRow.appendChild(this.createElement(tdTag, { text: frame.name, tooltip: frame.name }));
                    }
                    if (stacks.columnsWithContent[3] === true) {
                        fRow.appendChild(this.createElement(tdTag, { text: fLine, tooltip: fLine }));
                    }
                    if (stacks.columnsWithContent[4] === true) {
                        fRow.appendChild(this.createElement(tdTag,
                            { text: frame.location.fileName, tooltip: fLocation.fileName }));
                    }
                    if (stacks.columnsWithContent[5] === true) {
                        fRow.appendChild(this.createElement(tdTag, { text: fParameters, tooltip: fParameters }));
                    }
                    if (stacks.columnsWithContent[6] === true) {
                        fRow.appendChild(this.createElement(tdTag, { text: fThreadId, tooltip: fThreadId }));
                    }

                    tableBodyEle.appendChild(fRow);
                }
            }
            tableEle.appendChild(tableBodyEle);

            panel.appendChild(tableEle);
        }

        return panel;
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
     * Creates a html link element that when clicked will open the source in the VSCode Editor
     * @param location The location object that represents where the link points to
     * @param linkText The text to display on the link
     */
    private createSourceLink(location: Location, linkText: string): HTMLAnchorElement {
        let sourceLink: HTMLAnchorElement;
        if (location.uri !== undefined) {
            // @ts-ignore external exist on the webview side
            const file = location.uri.external.replace("%3A", ":");
            sourceLink = this.createElement("a", {
                attributes: {
                    "data-eCol": location.range[1].character.toString(),
                    "data-eLine": location.range[1].line.toString(),
                    "data-file": file,
                    "data-sCol": location.range[0].character.toString(),
                    "data-sLine": location.range[0].line.toString(),
                    "href": "#0",
                }, className: "sourcelink", text: linkText, tooltip: file,
            }) as HTMLAnchorElement;

            sourceLink.addEventListener("click", this.onSourceLinkClickedBind);
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
        const returnEle = this.createElement("div",
            { className: "tab", id: tabId, tooltip: tabTooltip }) as HTMLDivElement;
        returnEle.appendChild(this.createElement("label", { className: "tablabel", text: tabText }));
        returnEle.addEventListener("click", this.onTabClickedBind);
        return returnEle;
    }

    /**
     * Creates the Tabs Container content, the tabs at the top of the tab container
     * @param hasCodeFlows Flag to include the CodeFlow tab in the set of tabs
     * @param hasAttachments Flag to include the Attachments tab in the set of tabs
     */
    private createTabHeaderContainer(): HTMLDivElement {
        const container = this.createElement("div", { id: "tabcontainer" }) as HTMLDivElement;

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
    private initializeOpenedTab(activeTab?: tabNames) {
        let tab = activeTab;
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
    private loadResultDetails() {
        const resultInfo = this.diagnostic.resultInfo;
        this.hasCodeFlows = resultInfo.codeFlows !== undefined;
        this.hasAttachments = resultInfo.attachments !== undefined;
        this.hasFixes = resultInfo.fixes !== undefined;
        this.hasStacks = resultInfo.stacks !== undefined;

        this.createResultDetailsHeader(resultInfo);

        const resultDetailsContainer = document.getElementById("resultdetailscontainer") as HTMLDivElement;

        const resultDetails = this.createElement("div", { id: "resultdescription" }) as HTMLDivElement;
        if (resultInfo.message.html !== undefined) {
            resultDetails.innerHTML = resultInfo.message.html;
        }

        resultDetailsContainer.appendChild(resultDetails);
        resultDetailsContainer.appendChild(this.createTabHeaderContainer());

        // Create and add the panels
        const panelContainer = this.createElement("div", { id: "tabcontentcontainer" }) as HTMLDivElement;
        panelContainer.appendChild(this.createPanelResultInfo(resultInfo));
        panelContainer.appendChild(this.createPanelCodeFlow(resultInfo.codeFlows));
        panelContainer.appendChild(this.createPanelRunInfo(this.diagnostic.runInfo));
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
    private onAttachmentClicked(event: MouseEvent) {
        let ele = event.srcElement as HTMLElement;
        if (ele.classList.contains("treenodelocation")) {
            ele = ele.parentElement;
        }

        if (!ele.classList.contains("unexpandable") && event.offsetX < 17/*width of the expand/collapse arrows*/) {
            this.toggleTreeElement(ele);
        } else {
            this.sendMessage({ data: ele.id, type: MessageType.AttachmentSelectionChange } as WebviewMessage);
        }
    }

    /**
     * Callback when user clicks on the header, for showing and hiding the Results list or Results Details sections
     * @param event event fired when user clicked a header
     */
    private onHeaderClicked(event: MouseEvent) {
        let ele = event.srcElement as HTMLElement;
        while (!ele.classList.contains("headercontainer")) {
            ele = ele.parentElement as HTMLElement;
        }

        let otherHeaderId = "resultslistheader";
        if (ele.id === "resultslistheader") {
            otherHeaderId = "resultdetailsheader";
        }

        const otherHeaderEle = document.getElementById(otherHeaderId);
        if (ele.classList.contains(ToggleState.collapsed)) {
            ele.classList.replace(ToggleState.collapsed, ToggleState.expanded);
            otherHeaderEle.classList.replace(ToggleState.expanded, ToggleState.collapsed);
        } else if (ele.classList.contains(ToggleState.expanded)) {
            ele.classList.replace(ToggleState.expanded, ToggleState.collapsed);
            otherHeaderEle.classList.replace(ToggleState.collapsed, ToggleState.expanded);
        }

        if (document.getElementById("resultslistheader").classList.contains(ToggleState.expanded)) {
            const table = $("#resultslisttable");
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
    private onCodeFlowTreeClicked(event: MouseEvent) {
        let ele = event.srcElement as HTMLElement;
        if (ele.classList.contains("treenodelocation")) {
            ele = ele.parentElement;
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
    private onCollapseAllClicked() {
        this.toggleTreeElements(ToggleState.expanded, ToggleState.collapsed);
    }

    /**
     * Callback when the user clicks the Expand all button
     * @param event event fired when user clicked Expand all button
     */
    private onExpandAllClicked() {
        this.toggleTreeElements(ToggleState.collapsed, ToggleState.expanded);
    }

    /**
     * Callback when user clicks on the Fix tree
     * @param event event fired when user clicked the fix tree
     */
    private onFixClicked(event: MouseEvent) {
        let ele = event.srcElement as HTMLElement;
        if (ele.classList.contains("treenodelocation")) {
            ele = ele.parentElement;
        }

        if (!ele.classList.contains("unexpandable") && event.offsetX < 17/*width of the expand/collapse arrows*/) {
            this.toggleTreeElement(ele);
        }
    }

    /**
     * Callback when a source link is clicked, sends the call back to the extension to handle opening the source file
     * @param event event fired when a sourcelink was clicked
     */
    private onSourceLinkClicked(event: MouseEvent) {
        const ele = event.currentTarget as HTMLElement;
        const msgData = {
            eCol: ele.dataset.ecol, eLine: ele.dataset.eline, file: ele.dataset.file, sCol: ele.dataset.scol,
            sLine: ele.dataset.sline,
        } as LocationData;
        this.sendMessage({ data: JSON.stringify(msgData), type: MessageType.SourceLinkClicked } as WebviewMessage);
    }

    /**
     * Callback when a tab(Result Info, Code Flow, etc.) is clicked
     * @param event event fired when user clicked a tab
     */
    private onTabClicked(event: MouseEvent) {
        // @ts-ignore: id does exist on the currentTarget property
        this.openTab(event.currentTarget.id);
    }

    /**
     * Toggles the group row as well as any stacks list rows that match the group
     * @param row Group row to toggled
     */
    private onToggleStackGroup(event: Event) {
        const row = event.currentTarget as HTMLTableRowElement;
        let hideRow = false;
        if (row.classList.contains(`${ToggleState.expanded}`)) {
            row.classList.replace(`${ToggleState.expanded}`, `${ToggleState.collapsed}`);
            hideRow = true;
        } else {
            row.classList.replace(`${ToggleState.collapsed}`, `${ToggleState.expanded}`);
        }

        const results = document.querySelectorAll("#stackstable > tbody > .listtablerow") as NodeListOf<Element>;

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
    private onVerbosityChange(event: Event) {
        this.updateTreeVerbosity();
    }

    /**
     * This method will remove the tabactive and tabcontentactive from the current active tab
     * And add it to the tab that was clicked
     * @param id id of the tab that was clicked
     */
    private openTab(id: string) {
        const activetab = document.getElementsByClassName("tab tabactive")[0];
        if (activetab !== undefined && activetab.id !== id) {
            activetab.classList.remove("tabactive");
            document.getElementById(activetab.id + "content").classList.remove("tabcontentactive");
        }

        document.getElementById(id).classList.add("tabactive");
        document.getElementById(id + "content").classList.add("tabcontentactive");

        if (id === tabNames.stacks) {
            const table = $("#stackstable");
            if (table !== null) {
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
    private selectCodeFlowNode(ele: HTMLElement) {
        const codeFlowSelectedClass = "codeflowselected";
        const cfSelected = document.getElementsByClassName(codeFlowSelectedClass);
        while (cfSelected.length > 0) {
            cfSelected[0].classList.remove(codeFlowSelectedClass);
        }
        ele.classList.add(codeFlowSelectedClass);
    }

    /**
     * Sets the diagnostic to display the info. Also sets the default values if they exist in the data parameter
     * @param data json stringify'd version of the diagnosticdata to be set
     */
    private setDiagnostic(data: string) {
        this.cleanUpResultDetails();
        const diagnosticData = JSON.parse(data) as DiagnosticData;
        this.diagnostic = diagnosticData;
        this.loadResultDetails();

        if (diagnosticData.selectedRow !== undefined) {
            this.showTreeNode(diagnosticData.selectedRow, true);
        }

        if (diagnosticData.activeTab !== undefined) {
            this.openTab(diagnosticData.activeTab);
        }

        if (diagnosticData.selectedVerbosity !== undefined) {
            (document.getElementById("codeflowverbosity") as HTMLInputElement).value = diagnosticData.selectedVerbosity;
            this.updateTreeVerbosity();
        }
    }

    /**
     * Sets the verbosity show state for each tree node that matches the passed in type
     * @param type type of the tree node("important" or "unimportant")
     * @param state verbosity show state to set the matching nodes to ("verbosityshow" or "verbosityhide")
     */
    private setVerbosityShowState(type: string, state: string) {
        const elements = document.getElementsByClassName(type);
        for (let i = 0; i < elements.length; i++) {
            const classes = elements.item(i).className.split(" ");
            classes[TreeClassNames.VerbosityShowState] = state;
            elements.item(i).className = classes.join(" ");
        }
    }

    /**
     * Gets the text and tooltip(a reduced version of the specs description) based on the result's kind
     * @param kind the results kind
     */
    private kindTextAndTooltip(kind: sarif.Result.kind) {
        const value = { text: kind || "", tooltip: KindTooltip[kind] || "" };
        return value;
    }

    /**
     * Gets the text and tooltip(from the specs description) based on the result's baselineState
     * @param baselineState the results severity level
     */
    private baselineStateTextAndTooltip(baselineState: sarif.Result.baselineState) {
        const value = { text: baselineState || "", tooltip: BaselineStateTooltip[baselineState] || "" };
        return value;
    }

    /**
     * Gets the text and tooltip(a reduced version of the specs description) based on the result's severity level
     * @param severity the results severity level
     */
    private severityTextAndTooltip(severity: sarif.Result.level) {
        const value = { text: severity || "", tooltip: SeverityTooltip[severity] || "" };
        return value;
    }

    /**
     * find the matching tree node and expands it's parents, if select is true the node gets selected
     * @param treeNodeId the id of the tree node to show
     * @param select flag if true the tree node will be selected after it's parents are expanded
     */
    private showTreeNode(treeNodeId: string, select: boolean) {
        const node = document.getElementById(treeNodeId);
        if (node !== null) {
            let parent = node.parentElement;
            while (!parent.classList.contains("codeflowtreeroot")) {
                parent.classList.replace(ToggleState.collapsed, ToggleState.expanded);
                parent = parent.parentElement;
            }

            if (select) {
                this.selectCodeFlowNode(node);
                node.focus();
            }
        }
    }

    /**
     * Toggles an element to the passed in state, or the opposite of it's current if no state is passed in
     * @param ele element that needs to toggle
     * @param toggleToState state to toggle it to, if not defined it will determine it based on the current state
     */
    private toggleTreeElement(ele: HTMLElement, toggleToState?: ToggleState) {
        const classNames = ele.className.split(" ");
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
    private toggleTreeElements(stateToToggle, toggleToState) {
        const treeroots = document.getElementsByClassName("codeflowtreeroot");
        for (let i = 0; i < treeroots.length; i++) {
            const elements = treeroots.item(i).getElementsByClassName(stateToToggle);
            while (elements.length > 0) {
                this.toggleTreeElement(elements[0] as HTMLElement, toggleToState);
            }
        }
    }

    /**
     * Updates the CodeFlow trees to only show the nodes based on the current verbosity setting
     */
    private updateTreeVerbosity() {
        const hide = "verbosityhide";
        const show = "verbosityshow";
        const value = (document.getElementById("codeflowverbosity") as HTMLInputElement).value;
        let importantClass;
        let unimportantClass;
        let verbosityRequest;

        switch (value) {
            case "0":
                importantClass = hide;
                unimportantClass = hide;
                verbosityRequest = "essential";
                break;
            case "1":
                importantClass = show;
                unimportantClass = hide;
                verbosityRequest = "important";
                break;
            case "2":
                importantClass = show;
                unimportantClass = show;
                verbosityRequest = "unimportant";
                break;
        }

        this.setVerbosityShowState("important", importantClass);
        this.setVerbosityShowState("unimportant", unimportantClass);

        this.sendMessage({ data: verbosityRequest, type: MessageType.VerbosityChanged } as WebviewMessage);
    }

}

// @ts-ignore: This is used to instantiate the main class
const explorerWebview = new ExplorerWebview();
explorerWebview.sendMessage({ data: "", type: MessageType.ExplorerLoaded } as WebviewMessage);
