/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

/// <reference path="./enums.ts" />
/// <reference path="./webview.ts" />

import * as sarif from "sarif";
import {
    ResultsListBaselineValue, ResultsListData, ResultsListGroup, ResultsListKindValue, ResultsListRow,
    ResultsListSeverityValue, ResultsListValue, DiagnosticData,
} from "../common/Interfaces";

import { ExplorerWebview } from "./webview";
import { TextAndTooltip } from "./textAndTooltip";

/**
 * This class handles generating and providing the HTML content for the Results List in the Explorer
 */
export class ResultsList {
    public colResizeObj = {
        disabledColumns: [0], headerOnly: true, liveDrag: true, minWidth: 26, partialRefresh: true, postbackSafe: true,
    };
    private collapsedGroups: string[];
    private data: ResultsListData;

    private readonly webview: ExplorerWebview;
    private severityIconHTMLEles: Map<sarif.Result.level, HTMLElement>;

    public constructor(explorer: ExplorerWebview) {
        this.webview = explorer;
        this.collapsedGroups = [];
        this.createResultsListHeader();
        this.createResultsListPanelButtons();
        this.data = {
            columns: {},
            filterCaseMatch: false,
            filterText: "",
            groups: [],
            resultCount: 0
        };

        this.severityIconHTMLEles = new Map<sarif.Result.level, HTMLElement>();
        const sevEle: HTMLDivElement = this.webview.createElement("div", { className: "severityiconwrapper" });
        sevEle.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" fill="#1e1e1e"/>
            <path d="M8 3C5.2 3 3 5.2 3 8s2.2 5 5 5 5-2.2 5-5 -2.2-5-5-5Zm3 7l-1 1 -2-2 -2 2 -1-1 2-2L5
                6l1-1 2 2 2-2 1 1 -2 2L11 10Z" fill="#f48771"/>
            <path d="M11 6l-1-1 -2 2 -2-2 -1 1 2 2L5 10l1 1 2-2 2 2 1-1 -2-2Z" fill="#252526"/>
        </svg>`;
        this.severityIconHTMLEles.set("error", <HTMLElement>sevEle.cloneNode(true));

        sevEle.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.5 2L2 12l2 2h9l2-2L9.5 2Z" fill="#1e1e1e"/>
            <path d="M9 3H8l-4.5 9 1 1h8l1-1L9 3Zm0 9H8v-1h1v1Zm0-2H8V6h1v4Z" fill="#fc0"/>
            <path d="M9 10H8V6h1v4Zm0 1H8v1h1v-1Z"/>
        </svg>`;
        this.severityIconHTMLEles.set("warning", <HTMLElement>sevEle.cloneNode(true));

        sevEle.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8.5" cy="7.5" r="5.5" fill="#1e1e1e"/>
            <path d="M8.5 3C6 3 4 5 4 7.5S6 12 8.5 12 13 10 13 7.5 11 3 8.5 3Zm0.5 8H8V6h1v5Zm0-6H8V4h1v1Z"
                fill="#1ba1e2"/>
            <path d="M8 6h1v5H8V6Zm0-2v1h1V4H8Z" fill="#252526"/>
        </svg>`;
        this.severityIconHTMLEles.set("none", sevEle);
        this.severityIconHTMLEles.set("note", sevEle);
    }

    public set Data(value: ResultsListData) {
        if (value.groupBy !== undefined && (this.collapsedGroups[0] !== value.groupBy || this.data.resultCount !== value.resultCount)) {
            this.collapsedGroups = [value.groupBy];
            if (value.groups.length > 1) {
                for (let index: number = 0; index < value.groups.length; index++) {
                    if (value.groups[index].rows.length > 25) {
                        this.collapsedGroups.push(`${index}`);
                    }
                }
            }
        }
        this.data = value;
        this.updateResultsListHeader();
        this.updateResultsListPanelButtons();
        this.populateResultsListTable();
    }

    /**
     * Updates the selected row in the table
     */
    public updateSelection(): void {
        const diag: DiagnosticData | undefined = this.webview.diagnostic;
        if (!diag || !diag.resultInfo) {
            return;
        }

        const id: string = JSON.stringify({ resultId: diag.resultInfo.id, runId: diag.resultInfo.runId });
        const curSelected: HTMLCollectionOf<Element> = document.getElementsByClassName("listtablerow selected");
        while (curSelected.length > 0) {
            curSelected[0].classList.remove("selected");
        }

        const rows: HTMLCollectionOf<HTMLTableRowElement> = <HTMLCollectionOf<HTMLTableRowElement>>document.getElementsByClassName("listtablerow");
        // @ts-ignore: compiler complains even though results can be iterated
        for (const row of rows) {
            if (row.dataset.id === id) {
                row.classList.add("selected");
                this.expandGroupForResult(row);
                row.scrollIntoView();
                break;
            }
        }
    }

    /**
     * Creates the content that shows in the results list header of the Explorer window
     */
    private createResultsListHeader(): void {
        const header: HTMLDivElement = <HTMLDivElement>document.getElementById("resultslistheader");

        let resultCount: number = 0;
        if (this.data) {
            resultCount = this.data.resultCount;
        }
        header.appendChild(this.webview.createElement("label", {
            id: "resultslistheadertitle",
            text: `Results List`,
        }));

        header.appendChild(this.webview.createElement("label", {
            className: "countbadge",
            id: "resultslistheadercount",
            text: `${resultCount}`,
        }));

        // The bind to web-view's "this" is intentional, we want the click to run in the context of the web-view.
        header.addEventListener("click", this.webview.onHeaderClicked.bind(this.webview));
    }

    /**
     * Creates the results list panel buttons for manipulating the results list table
     */
    private createResultsListPanelButtons(): void {
        const buttonBar: HTMLElement | null = document.getElementById("resultslistbuttonbar");
        if (buttonBar && buttonBar.children.length === 0) {
            // Show/Hide column button
            const showColButton: HTMLElement = this.webview.createElement("select", {
                className: "svgIconMasking", id: "resultslistshowcol", tooltip: "Show or hide Columns",
            }) as HTMLSelectElement;
            showColButton.appendChild(this.webview.createElement("option", {
                attributes: { disabled: null, hidden: null, selected: null },
            }));
            showColButton.addEventListener("change", this.onShowChanged.bind(this));
            buttonBar.appendChild(showColButton);

            // Toggle Filter button
            const toggleFilterButtonContent: HTMLElement = this.webview.createElement("span", {
                id: "resultslistfilterbuttoncontainer",
                tooltip: "Filter Results List",
            }) as HTMLSpanElement;
            toggleFilterButtonContent.addEventListener("click", this.onToggleFilterInput.bind(this));
            const toggleFilterButtonIcon: HTMLElement = this.webview.createElement("span", {
                className: "svgIconMasking",
                id: "resultslistfilterbuttonsvg",
            });
            toggleFilterButtonContent.appendChild(toggleFilterButtonIcon);
            buttonBar.appendChild(toggleFilterButtonContent);

            // Expand All button
            const expandAllButton: HTMLElement = this.webview.createElement("span", {
                className: "tabcontentheaderbutton",
                text: "+",
                tooltip: "Expand all groups",
            }) as HTMLSpanElement;
            expandAllButton.addEventListener("click", this.onExpandAllGroups.bind(this));
            buttonBar.appendChild(expandAllButton);

            // Collapse All button
            const collapseAllButton: HTMLSpanElement = <HTMLSpanElement>expandAllButton.cloneNode();
            collapseAllButton.textContent = "-";
            collapseAllButton.title = "Collapse all groups";
            collapseAllButton.addEventListener("click", this.onCollapseAllGroups.bind(this));
            buttonBar.appendChild(collapseAllButton);

            buttonBar.appendChild(this.webview.createElement("span", { className: "headercontentseperator", text: "|" }));

            // Group By label and button
            buttonBar.appendChild(this.webview.createElement("label", {
                attributes: { for: "resultslistgroupby" }, id: "resultslistgroupbylabel", text: "Group by: ",
            }));
            const groupByButton: HTMLSelectElement = this.webview.createElement("select", {
                id: "resultslistgroupby", tooltip: "Group by",
            });
            groupByButton.appendChild(this.webview.createElement("option", {
                attributes: { disabled: null, hidden: null },
            }));
            groupByButton.addEventListener("change", this.onGroupByChanged.bind(this));
            buttonBar.appendChild(groupByButton);

            // Filter Input container
            const filterInputContainer: HTMLFormElement = this.webview.createElement("form", {
                className: "hidden",
                id: "resultslistfilterinputcontainer",
            });

            const filterInput: HTMLInputElement = this.webview.createElement("input", {
                attributes: { placeholder: "Filter. Eg: text", required: "", type: "text" },
                id: "resultslistfilterinput",
            });
            filterInput.addEventListener("input", this.onFilterInput.bind(this));
            filterInputContainer.appendChild(filterInput);

            filterInputContainer.addEventListener("reset", () => {
                (document.getElementById("resultslistfilterinput") as HTMLInputElement).focus();
                setTimeout(this.onFilterInput.bind(this), 0);
            });

            const filterInputClear: HTMLButtonElement  = this.webview.createElement("button", {
                attributes: { type: "reset" },
                id: "filterinputclearbutton",
                tooltip: "Clear filter",
            });
            filterInputContainer.appendChild(filterInputClear);

            const filterInputCaseMatchButton: HTMLButtonElement = this.webview.createElement("button", {
                attributes: {},
                id: "filterinputcasebutton",
                tooltip: "Match Case",
            });
            filterInputCaseMatchButton.addEventListener("click", this.onToggleFilterCaseMatch.bind(this));
            filterInputContainer.appendChild(filterInputCaseMatchButton);

            buttonBar.appendChild(filterInputContainer);
        }
    }

    /**
     * Creates the table body or group and result rows, using the columns for order and to show or hide
     * @param columns the tables header column elements
     */
    private createTableBody(columns: HTMLCollection): HTMLBodyElement {
        const tableBody: HTMLBodyElement = this.webview.createElement("tbody");
        for (let groupIndex: number = 0; groupIndex < this.data.groups.length; groupIndex++) {
            const group: ResultsListGroup = this.data.groups[groupIndex];
            let groupState: ToggleState = ToggleState.expanded;
            if (this.collapsedGroups.indexOf(`${groupIndex}`) !== -1) {
                groupState = ToggleState.collapsed;
            }

            const groupRow: HTMLTableRowElement = this.createTableGroupRow(columns, groupIndex, group, groupState);
            tableBody.appendChild(groupRow);

            const rows: DocumentFragment = this.createTableResultRows(columns, group.rows, groupIndex, groupState);
            tableBody.appendChild(rows);
        }

        return tableBody;
    }

    /**
     * Creates a group row, which has an expand/collapse handler to control visibilty of the rows in the group
     * @param cols the table's header column elements
     * @param groupId group id
     * @param group group for the row
     * @param state expanded or collapsed state
     */
    private createTableGroupRow(cols: HTMLCollection, groupId: number, group: ResultsListGroup, state: ToggleState):
        HTMLTableRowElement {
        const groupRow: HTMLTableRowElement = this.webview.createElement("tr", {
            attributes: { "data-group": groupId, "tabindex": "0" },
            className: `listtablegroup ${state}`,
        });
        groupRow.addEventListener("click", this.onToggleGroup.bind(this));

        let groupText: string = group.text;
        let groupTooltip: string = group.tooltip || group.text;
        if (this.data.groupBy === "severityLevel") {
            const sevInfo: TextAndTooltip = this.webview.severityTextAndTooltip(<sarif.Result.level>groupText);
            groupText = sevInfo.text;
            groupTooltip = sevInfo.tooltip;
        } else if (this.data.groupBy === "baselineState") {
            const baselineState: TextAndTooltip = this.webview.baselineStateTextAndTooltip(<sarif.Result.baselineState>groupText);
            groupText = baselineState.text;
            groupTooltip = baselineState.tooltip;
        }

        const groupCell: HTMLTableDataCellElement = this.webview.createElement("th", {
            attributes: { colspan: `${cols.length}` },
            text: groupText,
            tooltip: groupTooltip,
        });

        const countBadge: HTMLDivElement = this.webview.createElement("div", {
            className: "countbadge",
            text: `${group.rows.length}`,
        });
        groupCell.appendChild(countBadge);

        groupRow.appendChild(groupCell);

        return groupRow;
    }

    /**
     * Creates the header for the resultslist table
     */
    private createTableHeader(): HTMLHeadElement {
        const headerRow: HTMLTableRowElement = this.webview.createElement("tr");
        headerRow.appendChild(this.webview.createElement("th"));
        for (const colName in this.data.columns) {
            if (!this.data.columns[colName].hide && this.data.groupBy !== colName) {
                const cell: HTMLTableHeaderCellElement  = this.webview.createElement("th", {
                    attributes: {
                        "data-name": colName,
                    },
                });
                if (this.data.sortBy && this.data.sortBy.column === colName) {
                    let sortClass: string = "ascending";
                    if (this.data.sortBy.ascending) {
                        sortClass = "descending";
                    }
                    cell.appendChild(this.webview.createElement("span", {
                        attributes: {
                            "data-name": colName,
                        },
                        className: sortClass,
                    }));
                }
                cell.appendChild(this.webview.createElement("span", {
                    attributes: {
                        "data-name": colName,
                    },
                    text: this.data.columns[colName].title,
                    tooltip: this.data.columns[colName].description,
                }) as HTMLDivElement);
                cell.addEventListener("click", this.onSortClicked.bind(this));
                headerRow.appendChild(cell);
            }
        }

        const tableHead: HTMLHeadElement = this.webview.createElement("thead");
        tableHead.appendChild(headerRow);

        return tableHead;
    }

    /**
     * Creates all of the table rows for a group
     * @param cols the table's header column elements
     * @param rows array of results for this group
     * @param groupId group id
     * @param state expanded or collapsed state
     */
    private createTableResultRows(cols: HTMLCollection, rows: ResultsListRow[], groupId: number, state: ToggleState): DocumentFragment {
        const frag: DocumentFragment = document.createDocumentFragment();
        const resultRowBase: HTMLTableRowElement = this.webview.createElement("tr", {
            attributes: { "data-group": groupId, "tabindex": "0" },
            className: `listtablerow`,
        });

        const rowCellBase: HTMLTableDataCellElement = this.webview.createElement("td");

        for (const row of rows) {
            const resultRow: HTMLTableRowElement = <HTMLTableRowElement>resultRowBase.cloneNode();
            resultRow.dataset.id = JSON.stringify({ resultId: row.resultId.value, runId: row.runId.value });
            if (state === ToggleState.collapsed) {
                resultRow.classList.add("hidden");
            }

            const diag: DiagnosticData | undefined = this.webview.diagnostic;
            if (diag && diag.resultInfo.runId === row.runId.value &&
                diag.resultInfo.id === row.resultId.value) {
                resultRow.classList.add("selected");
            }

            const iconCell: HTMLTableCellElement = <HTMLTableCellElement>rowCellBase.cloneNode();
            iconCell.classList.add("severityiconcell");
            const severityIcon: HTMLElement | undefined = this.severityIconHTMLEles.get(row.severityLevel.value);
            if (!severityIcon) {
                throw new Error("Expected to be able to find severity icon.");
            }

            iconCell.appendChild(severityIcon.cloneNode(true));
            resultRow.appendChild(iconCell);

            for (let index: number = 1; index < cols.length; index++) {
                const col: HTMLTableHeaderCellElement = <HTMLTableHeaderCellElement>cols[index];
                const columnName: string | undefined = col.dataset.name;

                const colData: ResultsListValue | undefined = columnName !== undefined ? row[columnName] : undefined;
                let textAndTooltip: TextAndTooltip = { text: "", tooltip: "" };

                if (colData) {
                    textAndTooltip.text = colData.value || "";
                    textAndTooltip.tooltip = colData.tooltip || textAndTooltip.text;

                    if ((colData as ResultsListSeverityValue).customOrderType === 'Severity' && colData.value !== undefined) {
                        textAndTooltip = this.webview.severityTextAndTooltip(colData.value);
                    } else if ((colData as ResultsListBaselineValue).customOrderType === 'Baseline'  && colData.value !== undefined) {
                        textAndTooltip = this.webview.baselineStateTextAndTooltip(colData.value);
                    } else if ((colData as ResultsListKindValue).customOrderType === 'Kind' && colData.value !== undefined) {
                        textAndTooltip = this.webview.kindTextAndTooltip(colData.value);
                    }
                }

                const rowCell: HTMLTableDataCellElement = <HTMLTableDataCellElement>rowCellBase.cloneNode();
                rowCell.textContent = textAndTooltip.text;
                rowCell.title = textAndTooltip.tooltip;
                resultRow.appendChild(rowCell);
            }

            resultRow.addEventListener("click", this.onRowClicked.bind(this), true);
            frag.appendChild(resultRow);
        }

        return frag;
    }

    /**
     * Handler when collapse all is clicked
     * @param event event for click
     */
    private onCollapseAllGroups(event: Event): void {
        this.toggleAllGroups(ToggleState.expanded);
    }

    /**
     * Handler when expand all button is clicked
     * @param event event for click
     */
    private onExpandAllGroups(event: Event): void  {
        this.toggleAllGroups(ToggleState.collapsed);
    }

    /**
     * Handler when value is changed in the filter input
     * @param event event for value changed in input
     */
    private onFilterInput(event: Event): void  {
        const filterText: string = (<HTMLInputElement>document.getElementById("resultslistfilterinput")).value;
        this.webview.sendMessage({ data: filterText, type: MessageType.ResultsListFilterApplied });

        const filterIconContainer: HTMLElement | null = document.getElementById("resultslistfilterbuttoncontainer");
        if (!filterIconContainer) {
            return;
        }

        const activatedClass: string = "activated";
        const activeTooltip: string = ": Active";
        if (filterText !== "") {
            if (filterIconContainer.classList.contains(activatedClass) !== true) {
                filterIconContainer.classList.add(activatedClass);
                filterIconContainer.title = filterIconContainer.title + activeTooltip;
            }
        } else if (filterIconContainer.classList.contains(activatedClass) === true) {
            filterIconContainer.classList.remove(activatedClass);
            filterIconContainer.title = filterIconContainer.title.replace(activeTooltip, "");
        }
    }

    /**
     * Handler when a group by is changed
     * @param event event for change
     */
    private onGroupByChanged(event: Event): void {
        const srcElement: HTMLSelectElement = <HTMLSelectElement>(event.srcElement);
        const index: number = srcElement.selectedIndex;
        const col: string = (<HTMLOptionElement>srcElement.children[index]).value;
        this.webview.sendMessage({ data: col, type: MessageType.ResultsListGroupChanged });
    }

    /**
     * Handler when a result row is clicked, moves selection highlight and msg sends to extension
     * @param event event for row click
     */
    private onRowClicked(event: Event): void {
        const row: HTMLTableRowElement = <HTMLTableRowElement>event.currentTarget;
        if (!row.parentElement) {
            return;
        }

        const curSelected: HTMLCollectionOf<Element> = row.parentElement.getElementsByClassName("listtablerow selected");
        while (curSelected.length > 0) {
            curSelected[0].classList.remove("selected");
        }
        row.classList.add("selected");

        const resultId: string | undefined = row.dataset.id;
        if (resultId === undefined) {
            throw new Error("Expected resul id to be valid");
        }

        this.webview.sendMessage({ data: resultId, type: MessageType.ResultsListResultSelected });
    }

    /**
     * Handler when hide/show selections is changed, resets the selection to 0 so value doesn't show over the icon
     * @param event event for the change
     */
    private onShowChanged(event: Event): void {
        const selectElement: HTMLSelectElement = <HTMLSelectElement>event.srcElement;
        const index: number = selectElement.selectedIndex;
        const option: HTMLOptionElement = <HTMLOptionElement>selectElement.children[index];

        selectElement.selectedIndex = 0;
        this.webview.sendMessage({ data: option.value, type: MessageType.ResultsListColumnToggled });
    }

    /**
     * Handles toggling case match
     * @param event event for the toggle
     */
    private onToggleFilterCaseMatch(event: Event): void {
        (<HTMLInputElement>document.getElementById("resultslistfilterinput")).focus();
        this.webview.sendMessage({ data: "", type: MessageType.ResultsListFilterCaseToggled });
    }

    /**
     * Handles toggling visibility of the filter input
     * @param event event for the toggle
     */
    private onToggleFilterInput(event: Event): void  {
        const hiddenClass: string = "hidden";
        const filterInput: HTMLInputElement = <HTMLInputElement>document.getElementById("resultslistfilterinputcontainer");
        if (filterInput.classList.contains(hiddenClass) === true) {
            filterInput.classList.remove(hiddenClass);
            const htmlElementToFocus: HTMLElement | null = document.getElementById("resultslistfilterinput");
            if (htmlElementToFocus) {
                htmlElementToFocus.focus();
            }
        } else {
            filterInput.classList.add(hiddenClass);
        }
    }

    /**
     * Handler when sort is changed
     * @param event event for the header clicked
     */
    private onSortClicked(event: Event): void {
        const col: string | undefined = (<HTMLTableHeaderCellElement>event.srcElement).dataset.name;
        if (col === undefined) {
            throw new Error("Expected to have sorting column.");
        }

        this.webview.sendMessage({ data: col, type: MessageType.ResultsListSortChanged });
    }

    /**
     * Handler when a group row is clicked
     * @param event event for click
     */
    private onToggleGroup(event: Event): void {
        this.toggleGroup(<HTMLTableRowElement>event.currentTarget);
    }

    /**
     * Populates the Results list table, removes all rows, creates the header and body
     */
    private populateResultsListTable(): void {
        // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
        $("#resultslisttable").colResizable({ disable: true });

        // remove the rows of the table
        const table: HTMLTableElement = <HTMLTableElement>document.getElementById("resultslisttable");
        while (table.children.length > 0) {
            table.removeChild(table.children[0]);
        }

        const tableHead: HTMLHeadElement = this.createTableHeader();
        table.appendChild(tableHead);

        // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
        $("#resultslisttable").colResizable(this.colResizeObj);

        const tableBody: HTMLBodyElement = this.createTableBody(tableHead.children[0].children);
        table.appendChild(tableBody);
    }

    /**
     * Toggles all of the groups to either all collasped or all expaneded
     * @param stateToToggle The state either expanded or collapsed to toggle all groups to
     */
    private toggleAllGroups(stateToToggle: ToggleState): void {
        const className: string = `listtablegroup ${stateToToggle}`;
        const groups: HTMLCollectionOf<HTMLTableRowElement> = <HTMLCollectionOf<HTMLTableRowElement>>document.getElementsByClassName(className);

        while (groups.length > 0) {
            this.toggleGroup(groups[0]);
        }
    }

    /**
     * Toggles the group row as well as any result rows that match the group
     * @param row Group row to toggled
     */
    private toggleGroup(row: HTMLTableRowElement): void {

        if (row.dataset.group === undefined) {
            throw new Error("Expected to have collapse group.");
        }

        let hideRow: boolean = false;
        if (row.classList.contains(ToggleState.expanded)) {
            row.classList.replace(ToggleState.expanded, ToggleState.collapsed);
            this.collapsedGroups.push(row.dataset.group);
            hideRow = true;
        } else {
            row.classList.replace(ToggleState.collapsed, ToggleState.expanded);
            this.collapsedGroups.splice(this.collapsedGroups.indexOf(row.dataset.group), 1);
        }

        const results: NodeListOf<Element> = document.querySelectorAll("#resultslisttable > tbody > .listtablerow");

        // @ts-ignore: compiler complains even though results can be iterated
        for (const result of results) {
            // @ts-ignore: compiler complains even though result does have a dataset
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
     * Toggles the group row as well as any result rows that match the group
     * @param row Group row to toggled
     */
    private expandGroupForResult(row: HTMLTableRowElement): void {

        if (row.dataset.group === undefined) {
            throw new Error("Expected to have collapse group.");
        }

        if (row.classList.contains(ToggleState.collapsed)) {
            row.classList.replace(ToggleState.collapsed, ToggleState.expanded);
            this.collapsedGroups.splice(this.collapsedGroups.indexOf(row.dataset.group), 1);
        }

        const results: NodeListOf<Element> = document.querySelectorAll("#resultslisttable > tbody > .listtablerow");

        for (const result of results) {
            // @ts-ignore: compiler complains even though result does have a dataset
            if (result.dataset.group === row.dataset.group) {
                result.classList.remove("hidden");
            }
        }
    }

    /**
     * Updates the Results List header's count of all results
     */
    private updateResultsListHeader(): void {
        let resultCount: number = 0;
        if (this.data) {
            resultCount = this.data.resultCount;
        }

        const countElement: HTMLElement | null = document.getElementById("resultslistheadercount");
        if (!countElement) {
            return;
        }

        countElement.textContent = `${resultCount}`;
    }

    /**
     * Updates the group by and sort by options selected and checked, if no options exist adds them from the columns
     */
    private updateResultsListPanelButtons(): void {
        const groupByButton: HTMLElement | null = document.getElementById("resultslistgroupby");
        const showColButton: HTMLElement | null = document.getElementById("resultslistshowcol");

        if (!groupByButton) {
            throw new Error("Epxected to find group by button.");
        }

        if (!showColButton) {
            throw new Error("Epxected to find show column button.");
        }

        if (groupByButton.children.length === 1) {
            for (const col in this.data.columns) {
                if (this.data.columns.hasOwnProperty(col)) {
                    const groupOption: HTMLOptionElement = this.webview.createElement("option", {
                        attributes: { value: col }, text: this.data.columns[col].title,
                    });

                    const showOption: HTMLOptionElement = <HTMLOptionElement>groupOption.cloneNode(true);
                    // tslint:disable-next-line: no-irregular-whitespace
                    showOption.textContent = `  ${showOption.textContent}`;

                    groupByButton.appendChild(groupOption);
                    showColButton.appendChild(showOption);
                }
            }

            if (this.data.filterText !== "") {
                (document.getElementById("resultslistfilterinput") as HTMLInputElement).value = this.data.filterText;

                const filterIconContainer: HTMLElement | null = document.getElementById("resultslistfilterbuttoncontainer");
                if (filterIconContainer && filterIconContainer.classList.contains("activated") !== true) {
                    filterIconContainer.classList.add("activated");
                    filterIconContainer.title = filterIconContainer.title + ": Activated";
                }
            }
        }

        for (let index: number = 1; index < groupByButton.children.length; index++) {
            const groupOption: HTMLOptionElement = <HTMLOptionElement>groupByButton.children[index];
            const colKey: string = groupOption.value;

            groupOption.selected = colKey === this.data.groupBy;

            const showOption: Element = showColButton.children[index];
            if (this.data.columns[colKey].hide === true) {
                if (showOption.getAttribute("checked") !== null) {
                    showOption.removeAttribute("checked");
                    if (!showOption.textContent) {
                        showOption.textContent = "✓";

                    } else {
                        // tslint:disable-next-line: no-irregular-whitespace
                        showOption.textContent = showOption.textContent.replace("✓", " ");
                    }
                }
            } else {
                if (showOption.getAttribute("checked") === null) {
                    showOption.setAttribute("checked", "");
                    // tslint:disable-next-line: no-irregular-whitespace
                    if (!showOption.textContent) {
                        showOption.textContent = " ";

                    } else {
                        // tslint:disable-next-line: no-irregular-whitespace
                        showOption.textContent = showOption.textContent.replace(" ", "✓");
                    }
                }
            }
        }

        const caseButton: HTMLButtonElement = <HTMLButtonElement>document.getElementById("filterinputcasebutton");
        if (this.data.filterCaseMatch === true) {
            caseButton.classList.add("active");
        } else {
            caseButton.classList.remove("active");
        }
    }
}
