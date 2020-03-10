/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

/// <reference path="./enums.ts" />
import * as sarif from "sarif";
import {
    ResultsListBaselineValue, ResultsListData, ResultsListGroup, ResultsListKindValue, ResultsListRow,
    ResultsListSeverityValue, ResultsListValue, WebviewMessage,
} from "../common/Interfaces";

/**
 * This class handles generating and providing the HTML content for the Results List in the Explorer
 */
class ResultsList {
    public colResizeObj = {
        disabledColumns: [0], headerOnly: true, liveDrag: true, minWidth: 26, partialRefresh: true, postbackSafe: true,
    };
    private collapsedGroups: any[];
    private onCollapseAllGroupsBind;
    private onExpandAllGroupsBind;
    private onFilterInputBind;
    private onGroupByChangedBind;
    private onRowClickedBind;
    private onShowChangedBind;
    private onSortClickedBind;
    private onToggleFilterCaseMatchBind;
    private onToggleFilterInputBind;
    private onToggleGroupBind;
    private data: ResultsListData;

    private webview;
    private severityIconHTMLEles: Map<sarif.Result.level, HTMLDivElement>;

    public constructor(explorer) {
        this.webview = explorer;
        this.onCollapseAllGroupsBind = this.onCollapseAllGroups.bind(this);
        this.onExpandAllGroupsBind = this.onExpandAllGroups.bind(this);
        this.onFilterInputBind = this.onFilterInput.bind(this);
        this.onGroupByChangedBind = this.onGroupByChanged.bind(this);
        this.onRowClickedBind = this.onRowClicked.bind(this);
        this.onShowChangedBind = this.onShowChanged.bind(this);
        this.onSortClickedBind = this.onSortClicked.bind(this);
        this.onToggleFilterCaseMatchBind = this.onToggleFilterCaseMatch.bind(this);
        this.onToggleFilterInputBind = this.onToggleFilterInput.bind(this);
        this.onToggleGroupBind = this.onToggleGroup.bind(this);

        this.collapsedGroups = [];
        this.createResultsListHeader();
        this.createResultsListPanelButtons();

        this.severityIconHTMLEles = new Map<sarif.Result.level, HTMLDivElement>();
        const sevEle = this.webview.createElement("div", { className: "severityiconwrapper" });
        sevEle.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" fill="#1e1e1e"/>
            <path d="M8 3C5.2 3 3 5.2 3 8s2.2 5 5 5 5-2.2 5-5 -2.2-5-5-5Zm3 7l-1 1 -2-2 -2 2 -1-1 2-2L5
                6l1-1 2 2 2-2 1 1 -2 2L11 10Z" fill="#f48771"/>
            <path d="M11 6l-1-1 -2 2 -2-2 -1 1 2 2L5 10l1 1 2-2 2 2 1-1 -2-2Z" fill="#252526"/>
        </svg>`;
        this.severityIconHTMLEles.set("error", sevEle.cloneNode(true));

        sevEle.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.5 2L2 12l2 2h9l2-2L9.5 2Z" fill="#1e1e1e"/>
            <path d="M9 3H8l-4.5 9 1 1h8l1-1L9 3Zm0 9H8v-1h1v1Zm0-2H8V6h1v4Z" fill="#fc0"/>
            <path d="M9 10H8V6h1v4Zm0 1H8v1h1v-1Z"/>
        </svg>`;
        this.severityIconHTMLEles.set("warning", sevEle.cloneNode(true));

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
        if (this.collapsedGroups[0] !== value.groupBy || this.data.resultCount !== value.resultCount) {
            this.collapsedGroups = [value.groupBy];
            if (value.groups.length > 1) {
                for (let index = 0; index < value.groups.length; index++) {
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
    public updateSelection() {
        const diag = this.webview.diagnostic;
        const id = JSON.stringify({ resultId: diag.resultInfo.id, runId: diag.resultInfo.runId });
        const curSelected = document.getElementsByClassName("listtablerow selected");
        while (curSelected.length > 0) {
            curSelected[0].classList.remove("selected");
        }

        const rows = document.getElementsByClassName("listtablerow") as HTMLCollectionOf<HTMLElement>;
        // @ts-ignore: compiler complains even though results can be iterated
        for (const row of rows) {
            if (row.dataset.id === id) {
                row.classList.add("selected");
            }
        }
    }

    /**
     * Creates the content that shows in the results list header of the Explorer window
     */
    private createResultsListHeader() {
        const header = document.getElementById("resultslistheader") as HTMLDivElement;

        let resultCount = 0;
        if (this.data !== undefined) {
            resultCount = this.data.resultCount;
        }
        const countElement = document.getElementById("resultslistheadercount");
        header.appendChild(this.webview.createElement("label", {
            id: "resultslistheadertitle",
            text: `Results List`,
        }));

        header.appendChild(this.webview.createElement("label", {
            className: "countbadge",
            id: "resultslistheadercount",
            text: `${resultCount}`,
        }));

        header.addEventListener("click", this.webview.onHeaderClickedBind);
    }

    /**
     * Creates the results list panel buttons for manipulating the results list table
     */
    private createResultsListPanelButtons() {
        const buttons = document.getElementById("resultslistbuttonbar");
        if (buttons.children.length === 0) {
            // Show/Hide column button
            const showColButton = this.webview.createElement("select", {
                className: "svgIconMasking", id: "resultslistshowcol", tooltip: "Show or hide Columns",
            }) as HTMLSelectElement;
            showColButton.appendChild(this.webview.createElement("option", {
                attributes: { disabled: null, hidden: null, selected: null },
            }));
            showColButton.addEventListener("change", this.onShowChangedBind);
            buttons.appendChild(showColButton);

            // Toggle Filter button
            const toggleFilterButtonCont = this.webview.createElement("span", {
                id: "resultslistfilterbuttoncontainer",
                tooltip: "Filter Results List",
            }) as HTMLSpanElement;
            toggleFilterButtonCont.addEventListener("click", this.onToggleFilterInputBind);
            const toggleFilterButtonIcon = this.webview.createElement("span", {
                className: "svgIconMasking",
                id: "resultslistfilterbuttonsvg",
            });
            toggleFilterButtonCont.appendChild(toggleFilterButtonIcon);
            buttons.appendChild(toggleFilterButtonCont);

            // Expand All button
            const expandAllButton = this.webview.createElement("span", {
                className: "tabcontentheaderbutton",
                text: "+",
                tooltip: "Expand all groups",
            }) as HTMLSpanElement;
            expandAllButton.addEventListener("click", this.onExpandAllGroupsBind);
            buttons.appendChild(expandAllButton);

            // Collapse All button
            const collapseAllButton = expandAllButton.cloneNode() as HTMLSpanElement;
            collapseAllButton.textContent = "-";
            collapseAllButton.title = "Collapse all groups";
            collapseAllButton.addEventListener("click", this.onCollapseAllGroupsBind);
            buttons.appendChild(collapseAllButton);

            buttons.appendChild(this.webview.createElement("span", { className: "headercontentseperator", text: "|" }));

            // Group By label and button
            buttons.appendChild(this.webview.createElement("label", {
                attributes: { for: "resultslistgroupby" }, id: "resultslistgroupbylabel", text: "Group by: ",
            }));
            const groupByButton = this.webview.createElement("select", {
                id: "resultslistgroupby", tooltip: "Group by",
            }) as HTMLSelectElement;
            groupByButton.appendChild(this.webview.createElement("option", {
                attributes: { disabled: null, hidden: null },
            }));
            groupByButton.addEventListener("change", this.onGroupByChangedBind);
            buttons.appendChild(groupByButton);

            // Filter Input container
            const filterInputContainer = this.webview.createElement("form", {
                className: "hidden",
                id: "resultslistfilterinputcontainer",
            });

            const filterInput = this.webview.createElement("input", {
                attributes: { placeholder: "Filter. Eg: text", required: "", type: "text" },
                id: "resultslistfilterinput",
            });
            filterInput.addEventListener("input", this.onFilterInputBind);
            filterInputContainer.appendChild(filterInput);

            filterInputContainer.addEventListener("reset", () => {
                (document.getElementById("resultslistfilterinput") as HTMLInputElement).focus();
                setTimeout(this.onFilterInputBind, 0);
            });

            const filterInputClear = this.webview.createElement("button", {
                attributes: { type: "reset" },
                id: "filterinputclearbutton",
                tooltip: "Clear filter",
            });
            filterInputContainer.appendChild(filterInputClear);

            const filterInputCaseMatchButton = this.webview.createElement("button", {
                attributes: {},
                id: "filterinputcasebutton",
                tooltip: "Match Case",
            });
            filterInputCaseMatchButton.addEventListener("click", this.onToggleFilterCaseMatchBind);
            filterInputContainer.appendChild(filterInputCaseMatchButton);

            buttons.appendChild(filterInputContainer);
        }
    }

    /**
     * Creates the table body or group and result rows, using the columns for order and to show or hide
     * @param columns the tables header column elements
     */
    private createTableBody(columns: HTMLCollection): HTMLBodyElement {
        const tableBody = this.webview.createElement("tbody") as HTMLBodyElement;
        for (let groupIndex = 0; groupIndex < this.data.groups.length; groupIndex++) {
            const group = this.data.groups[groupIndex];
            let groupState = ToggleState.expanded;
            if (this.collapsedGroups.indexOf(`${groupIndex}`) !== -1) {
                groupState = ToggleState.collapsed;
            }

            const groupRow = this.createTableGroupRow(columns, groupIndex, group, groupState);
            tableBody.appendChild(groupRow);

            const rows = this.createTableResultRows(columns, group.rows, groupIndex, groupState);
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
        const groupRow = this.webview.createElement("tr", {
            attributes: { "data-group": groupId, "tabindex": "0" },
            className: `listtablegroup ${state}`,
        }) as HTMLTableRowElement;
        groupRow.addEventListener("click", this.onToggleGroupBind);

        let groupText = group.text;
        let groupTooltip = group.tooltip || group.text;
        if (this.data.groupBy === "severityLevel") {
            const sevInfo = this.webview.severityTextAndTooltip(groupText);
            groupText = sevInfo.text;
            groupTooltip = sevInfo.tooltip;
        } else if (this.data.groupBy === "baselineState") {
            const baselineState = this.webview.baselineStateTextAndTooltip(groupText);
            groupText = baselineState.text;
            groupTooltip = baselineState.tooltip;
        }

        const groupCell = this.webview.createElement("th", {
            attributes: { colspan: `${cols.length}` },
            text: groupText,
            tooltip: groupTooltip,
        }) as HTMLTableDataCellElement;

        const countBadge = this.webview.createElement("div", {
            className: "countbadge",
            text: `${group.rows.length}`,
        }) as HTMLDivElement;
        groupCell.appendChild(countBadge);

        groupRow.appendChild(groupCell);

        return groupRow;
    }

    /**
     * Creates the header for the resultslist table
     */
    private createTableHeader(): HTMLHeadElement {
        const headerRow = this.webview.createElement("tr") as HTMLTableRowElement;
        headerRow.appendChild(this.webview.createElement("th"));
        for (const colName in this.data.columns) {
            if (!this.data.columns[colName].hide && this.data.groupBy !== colName) {
                const cell = this.webview.createElement("th", {
                    attributes: {
                        "data-name": colName,
                    },
                });
                if (this.data.sortBy.column === colName) {
                    let sortClass = "ascending";
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
                cell.addEventListener("click", this.onSortClickedBind);
                headerRow.appendChild(cell);
            }
        }

        const tableHead = this.webview.createElement("thead") as HTMLHeadElement;
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
    private createTableResultRows(cols: HTMLCollection, rows: ResultsListRow[], groupId: number, state: ToggleState) {
        const frag = document.createDocumentFragment();
        const resultRowBase = this.webview.createElement("tr", {
            attributes: { "data-group": groupId, "tabindex": "0" },
            className: `listtablerow`,
        }) as HTMLTableRowElement;

        const rowCellBase = this.webview.createElement("td") as HTMLTableDataCellElement;

        for (const row of rows) {
            const resultRow = resultRowBase.cloneNode() as HTMLTableRowElement;
            resultRow.dataset.id = JSON.stringify({ resultId: row.resultId.value, runId: row.runId.value });
            if (state === ToggleState.collapsed) {
                resultRow.classList.add("hidden");
            }

            const diag = this.webview.diagnostic;
            if (diag !== undefined && diag.resultInfo.runId === row.runId.value &&
                diag.resultInfo.id === row.resultId.value) {
                resultRow.classList.add("selected");
            }

            const iconCell = rowCellBase.cloneNode() as HTMLTableCellElement;
            iconCell.classList.add("severityiconcell");
            iconCell.appendChild(this.severityIconHTMLEles.get(row.severityLevel.value).cloneNode(true));
            resultRow.appendChild(iconCell);

            for (let index = 1; index < cols.length; index++) {
                const col = cols[index] as HTMLTableHeaderCellElement;
                const columnName = col.dataset.name;
                const colData = row[columnName] as ResultsListValue;
                let textAndTooltip = { text: "", tooltip: "" };

                if (colData !== undefined) {
                    textAndTooltip.text = colData.value || "";
                    textAndTooltip.tooltip = colData.tooltip || textAndTooltip.text;

                    if ((colData as ResultsListSeverityValue).isSeverity && colData.value !== undefined) {
                        textAndTooltip = this.webview.severityTextAndTooltip(colData.value);
                    } else if ((colData as ResultsListBaselineValue).isBaseLine && colData.value !== undefined) {
                        textAndTooltip = this.webview.baselineStateTextAndTooltip(colData.value);
                    } else if ((colData as ResultsListKindValue).isKind && colData.value !== undefined) {
                        textAndTooltip = this.webview.kindTextAndTooltip(colData.value);
                    }
                }

                const rowCell = rowCellBase.cloneNode() as HTMLTableDataCellElement;
                rowCell.textContent = textAndTooltip.text;
                rowCell.title = textAndTooltip.tooltip;
                resultRow.appendChild(rowCell);
            }

            resultRow.addEventListener("click", this.onRowClickedBind, true);
            frag.appendChild(resultRow);
        }

        return frag;
    }

    /**
     * Handler when collapse all is clicked
     * @param event event for click
     */
    private onCollapseAllGroups(event) {
        this.toggleAllGroups(ToggleState.expanded);
    }

    /**
     * Handler when expand all button is clicked
     * @param event event for click
     */
    private onExpandAllGroups(event) {
        this.toggleAllGroups(ToggleState.collapsed);
    }

    /**
     * Handler when value is changed in the filter input
     * @param event event for value changed in input
     */
    private onFilterInput(event) {
        const filterText = (document.getElementById("resultslistfilterinput") as HTMLInputElement).value;
        this.webview.sendMessage({ data: filterText, type: MessageType.ResultsListFilterApplied } as WebviewMessage);

        const filterIconContainer = document.getElementById("resultslistfilterbuttoncontainer");
        const activatedClass = "activated";
        const activeTooltip = ": Active";
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
    private onGroupByChanged(event) {
        const index = (event.srcElement as HTMLSelectElement).selectedIndex;
        const col = event.srcElement.children[index].value;
        this.webview.sendMessage({ data: col, type: MessageType.ResultsListGroupChanged } as WebviewMessage);
    }

    /**
     * Handler when a result row is clicked, moves selection highlight and msg sends to extension
     * @param event event for row click
     */
    private onRowClicked(event) {
        const row = event.currentTarget as HTMLTableRowElement;
        const curSelected = row.parentElement.getElementsByClassName("listtablerow selected");
        while (curSelected.length > 0) {
            curSelected[0].classList.remove("selected");
        }
        row.classList.add("selected");

        const resultId = row.dataset.id;
        this.webview.sendMessage({ data: resultId, type: MessageType.ResultsListResultSelected } as WebviewMessage);
    }

    /**
     * Handler when hide/show selections is changed, resets the selection to 0 so value doesn't show over the icon
     * @param event event for the change
     */
    private onShowChanged(event) {
        const index = (event.srcElement as HTMLSelectElement).selectedIndex;
        const option = event.srcElement.children[index] as HTMLOptionElement;

        (event.srcElement as HTMLSelectElement).selectedIndex = 0;
        this.webview.sendMessage({ data: option.value, type: MessageType.ResultsListColumnToggled } as WebviewMessage);
    }

    /**
     * Handles toggling case match
     * @param event event for the toggle
     */
    private onToggleFilterCaseMatch(event) {
        (document.getElementById("resultslistfilterinput") as HTMLInputElement).focus();
        this.webview.sendMessage({ data: "", type: MessageType.ResultsListFilterCaseToggled } as WebviewMessage);
    }

    /**
     * Handles toggling visibility of the filter input
     * @param event event for the toggle
     */
    private onToggleFilterInput(event) {
        const hiddenClass = "hidden";
        const filterInput = document.getElementById("resultslistfilterinputcontainer") as HTMLInputElement;
        if (filterInput.classList.contains(hiddenClass) === true) {
            filterInput.classList.remove(hiddenClass);
            document.getElementById("resultslistfilterinput").focus();
        } else {
            filterInput.classList.add(hiddenClass);
        }
    }

    /**
     * Handler when sort is changed
     * @param event event for the header clicked
     */
    private onSortClicked(event) {
        const col = event.srcElement.dataset.name;
        this.webview.sendMessage({ data: col, type: MessageType.ResultsListSortChanged } as WebviewMessage);
    }

    /**
     * Handler when a group row is clicked
     * @param event event for click
     */
    private onToggleGroup(event: Event) {
        this.toggleGroup(event.currentTarget as HTMLTableRowElement);
    }

    /**
     * Populates the Results list table, removes all rows, creates the header and body
     */
    private populateResultsListTable() {
        // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
        $("#resultslisttable").colResizable({ disable: true });

        // remove the rows of the table
        const table = document.getElementById("resultslisttable") as HTMLTableElement;
        while (table.children.length > 0) {
            table.removeChild(table.children[0]);
        }

        const tableHead = this.createTableHeader();
        table.appendChild(tableHead);

        // @ts-ignore: colResizeable comes from the colResizable plugin, but there is no types file for it
        $("#resultslisttable").colResizable(this.colResizeObj);

        const tableBody = this.createTableBody(tableHead.children[0].children);
        table.appendChild(tableBody);
    }

    /**
     * Toggles all of the groups to either all collasped or all expaneded
     * @param stateToToggle The state either expanded or collapsed to toggle all groups to
     */
    private toggleAllGroups(stateToToggle: ToggleState) {
        const className = `listtablegroup ${stateToToggle}`;
        const groups = document.getElementsByClassName(className) as HTMLCollectionOf<HTMLTableRowElement>;

        while (groups.length > 0) {
            this.toggleGroup(groups[0]);
        }
    }

    /**
     * Toggles the group row as well as any result rows that match the group
     * @param row Group row to toggled
     */
    private toggleGroup(row: HTMLTableRowElement) {
        let hideRow = false;
        if (row.classList.contains(`${ToggleState.expanded}`)) {
            row.classList.replace(`${ToggleState.expanded}`, `${ToggleState.collapsed}`);
            this.collapsedGroups.push(row.dataset.group);
            hideRow = true;
        } else {
            row.classList.replace(`${ToggleState.collapsed}`, `${ToggleState.expanded}`);
            this.collapsedGroups.splice(this.collapsedGroups.indexOf(row.dataset.group), 1);
        }

        const results = document.querySelectorAll("#resultslisttable > tbody > .listtablerow") as NodeListOf<Element>;

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
     * Updates the Results List header's count of all results
     */
    private updateResultsListHeader() {
        let resultCount = 0;
        if (this.data !== undefined) {
            resultCount = this.data.resultCount;
        }

        const countElement = document.getElementById("resultslistheadercount");
        countElement.textContent = `${resultCount}`;
    }

    /**
     * Updates the group by and sort by options selected and checked, if no options exist adds them from the columns
     */
    private updateResultsListPanelButtons() {
        const groupByButton = document.getElementById("resultslistgroupby");
        const showColButton = document.getElementById("resultslistshowcol");

        if (groupByButton.children.length === 1) {
            for (const col in this.data.columns) {
                if (this.data.columns.hasOwnProperty(col)) {
                    const groupOption = this.webview.createElement("option", {
                        attributes: { value: col }, text: this.data.columns[col].title,
                    }) as HTMLOptionElement;

                    const showOption = groupOption.cloneNode(true) as HTMLOptionElement;
                    showOption.textContent = "  " + showOption.textContent;

                    groupByButton.appendChild(groupOption);
                    showColButton.appendChild(showOption);
                }
            }

            if (this.data.filterText !== "") {
                (document.getElementById("resultslistfilterinput") as HTMLInputElement).value = this.data.filterText;

                const filterIconContainer = document.getElementById("resultslistfilterbuttoncontainer");
                if (filterIconContainer.classList.contains("activated") !== true) {
                    filterIconContainer.classList.add("activated");
                    filterIconContainer.title = filterIconContainer.title + ": Activated";
                }
            }
        }

        for (let index = 1; index < groupByButton.children.length; index++) {
            const groupOption = groupByButton.children[index] as HTMLOptionElement;
            const colKey = groupOption.value;

            if (colKey === this.data.groupBy) {
                groupOption.selected = true;
            } else {
                groupOption.selected = undefined;
            }

            const showOption = showColButton.children[index];
            if (this.data.columns[colKey].hide === true) {
                if (showOption.getAttribute("checked") !== null) {
                    showOption.removeAttribute("checked");
                    showOption.textContent = showOption.textContent.replace("✓", " ");
                }
            } else {
                if (showOption.getAttribute("checked") === null) {
                    showOption.setAttribute("checked", "");
                    showOption.textContent = showOption.textContent.replace(" ", "✓");
                }
            }
        }

        const caseButton = document.getElementById("filterinputcasebutton") as HTMLButtonElement;
        if (this.data.filterCaseMatch === true) {
            caseButton.classList.add("active");
        } else {
            caseButton.classList.remove("active");
        }
    }
}
