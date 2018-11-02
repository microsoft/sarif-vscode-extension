// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import {
    ConfigurationChangeEvent, Disposable, Position, Selection, TextEditorRevealType, ViewColumn, window, workspace,
    WorkspaceConfiguration,
} from "vscode";
import { MessageType, SeverityLevelOrder } from "./common/Enums";
import {
    ResultInfo, ResultsListColumn, ResultsListData, ResultsListGroup, ResultsListPositionValue, ResultsListRow,
    ResultsListSeverityValue, ResultsListSortBy, ResultsListValue, SarifViewerDiagnostic, WebviewMessage,
} from "./common/Interfaces";
import { sarif } from "./common/SARIFInterfaces";
import { ExplorerController } from "./ExplorerController";
import { SVCodeActionProvider } from "./SVCodeActionProvider";
import { SVDiagnosticCollection } from "./SVDiagnosticCollection";
import { Utilities } from "./Utilities";

/**
 * Class that acts as the data controller for the ResultsList in the Sarif Explorer
 */
export class ResultsListController {
    private static instance: ResultsListController;

    private columns: { [key: string]: ResultsListColumn };
    private groupBy: string;
    private sortBy: ResultsListSortBy;

    private resultsListRows: ResultsListRow[];

    private readonly configHideColumns = "resultsListHideColumns";
    private readonly configGroupBy = "resultsListGroupBy";
    private readonly configSortBy = "resultsListSortBy";

    private changeSettingsDisposable: Disposable;

    private constructor() {
        this.resultsListRows = [];
        this.initializeColumns();
        this.onSettingsChanged(undefined);
        this.changeSettingsDisposable = workspace.onDidChangeConfiguration(this.onSettingsChanged, this);
    }

    public static get Instance() {
        return ResultsListController.instance || (ResultsListController.instance = new ResultsListController());
    }

    /**
     * For disposing on extension close
     */
    public dispose() {
        this.changeSettingsDisposable.dispose();
    }

    /**
     * Updates the Results List data set with the array of diags, it either adds, updates, or removes(if flag is set)
     * @param diags Array of diags that need to be updated
     * @param remove flag to remove the diags in the array, otherwise they will be udpated
     */
    public updateResultsListData(diags: SarifViewerDiagnostic[], remove?: boolean) {
        if (remove === true) {
            for (const key of diags.keys()) {
                const rowIndex = this.findMatchingRow(diags[key].resultInfo.runId, diags[key].resultInfo.id);

                if (rowIndex !== -1) {
                    this.resultsListRows.splice(rowIndex, 1);
                }
            }
        } else {
            for (const key of diags.keys()) {
                const resultInfo = diags[key].resultInfo;

                const row = this.createResultsListRow(resultInfo);
                const rowIndex = this.findMatchingRow(resultInfo.runId, resultInfo.id);

                if (rowIndex === -1) {
                    this.resultsListRows.push(row);
                } else {
                    this.resultsListRows.splice(rowIndex, 1, row);
                }
            }
        }
    }

    /**
     * Called by the ExplorerController when a message comes from the results list in the webview
     * @param msg message from the web view
     */
    public onResultsListMessage(msg: WebviewMessage) {
        const sarifConfig = workspace.getConfiguration(Utilities.configSection);
        switch (msg.type) {
            case MessageType.ResultsListColumnToggled:
                const hideColsConfig = sarifConfig.get(this.configHideColumns) as string[];
                const index = hideColsConfig.indexOf(msg.data);
                if (index !== -1) {
                    hideColsConfig.splice(index, 1);
                } else {
                    hideColsConfig.push(msg.data);
                }
                sarifConfig.update(this.configHideColumns, hideColsConfig, true);
                break;
            case MessageType.ResultsListGroupChanged:
                let groupByConfig = sarifConfig.get(this.configGroupBy) as string;
                if (groupByConfig !== msg.data) {
                    groupByConfig = msg.data;
                }
                sarifConfig.update(this.configGroupBy, groupByConfig, true);
                break;
            case MessageType.ResultsListResultSelected:
                const id = JSON.parse(msg.data);
                const diagnostic = SVDiagnosticCollection.Instance.getResultInfo(id.resultId, id.runId);
                const diagLocation = diagnostic.resultInfo.assignedLocation;
                workspace.openTextDocument(diagLocation.uri).then((doc) => {
                    return window.showTextDocument(doc, ViewColumn.One, true);
                }).then((editor) => {
                    editor.revealRange(diagLocation.range, TextEditorRevealType.InCenterIfOutsideViewport);
                    editor.selection = new Selection(diagLocation.range.start, diagLocation.range.start);
                    SVCodeActionProvider.Instance.provideCodeActions(undefined, undefined,
                        { diagnostics: [diagnostic] }, undefined);
                }, (reason) => {
                    // Failed to map after asking the user, fail silently as there's no location to add the selection
                    return Promise.resolve();
                });
                break;
            case MessageType.ResultsListSortChanged:
                const sortByConfig = sarifConfig.get(this.configSortBy) as ResultsListSortBy;
                if (sortByConfig.column === msg.data) {
                    sortByConfig.ascending = !sortByConfig.ascending;
                } else {
                    sortByConfig.column = msg.data;
                    sortByConfig.ascending = true;
                }
                sarifConfig.update(this.configSortBy, sortByConfig, true);
                break;
        }
    }

    /**
     * Event handler when settings are changed, handles hide columns, groupby, and sortby changes
     * @param event configuration change event
     */
    public onSettingsChanged(event: ConfigurationChangeEvent) {
        if (event === undefined || event.affectsConfiguration(Utilities.configSection)) {
            const sarifConfig = workspace.getConfiguration(Utilities.configSection);

            let changed = false;
            if (this.checkIfColumnsChanged(sarifConfig) === true) {
                changed = true;
            }
            if (this.checkIfGroupByChanged(sarifConfig) === true) {
                changed = true;
            }
            if (this.checkIfSortByChanged(sarifConfig) === true) {
                changed = true;
            }

            if (changed === true) {
                this.postDataToExplorer();
            }
        }
    }

    /**
     * Gets the latest Result data, grouped and sorted and sends it to the Explorer Controller to send to the Explorer
     */
    public postDataToExplorer() {
        const data: ResultsListData = this.getResultData();
        ExplorerController.Instance.setResultsListData(data);
    }

    /**
     * Checks if the hide columns have changed in the settings
     * @param sarifConfig config object with the sarif settings
     */
    private checkIfColumnsChanged(sarifConfig: WorkspaceConfiguration): boolean {
        let changed = false;
        const hideCols = sarifConfig.get(this.configHideColumns) as string[];

        for (const col in this.columns) {
            if (this.columns.hasOwnProperty(col)) {
                let shouldHide = false;
                if (hideCols.indexOf(col) !== -1) {
                    shouldHide = true;
                }

                if (shouldHide !== this.columns[col].hide) {
                    this.columns[col].hide = shouldHide;
                    changed = true;
                }
            }
        }

        return changed;
    }

    /**
     * Checks if the group by has changed in the settings
     * @param sarifConfig config object with the sarif settings
     */
    private checkIfGroupByChanged(sarifConfig: WorkspaceConfiguration): boolean {
        let changed = false;
        const group = sarifConfig.get(this.configGroupBy) as string;

        if (group !== this.groupBy) {
            this.groupBy = group;
            changed = true;
        }
        return changed;
    }

    /**
     * Checks if the sort by has changed in the settings
     * @param sarifConfig config object with the sarif settings
     */
    private checkIfSortByChanged(sarifConfig: WorkspaceConfiguration): boolean {
        let changed = false;
        const sort = sarifConfig.get(this.configSortBy) as ResultsListSortBy;

        if (sort !== this.sortBy) {
            this.sortBy = sort;
            changed = true;
        }

        return changed;
    }

    /**
     * Creates a Result list row using the data from the result info passed in
     * @param resultInfo Result info that needs to be converted to a row of data for the Results List
     */
    private createResultsListRow(resultInfo: ResultInfo): ResultsListRow {
        const row = {} as ResultsListRow;
        row.message = { value: resultInfo.message.text };
        row.resultId = { value: resultInfo.id };
        row.ruleId = { value: resultInfo.ruleId };
        row.ruleName = { value: resultInfo.ruleName };
        row.runId = { value: resultInfo.runId };
        const run = SVDiagnosticCollection.Instance.getRunInfo(resultInfo.runId);
        row.sarifFile = { value: run.sarifFileName, tooltip: run.sarifFileFullPath };
        let sevOrder: SeverityLevelOrder;
        switch (resultInfo.severityLevel) {
            case sarif.Result.level.error: sevOrder = SeverityLevelOrder.error; break;
            case sarif.Result.level.warning: sevOrder = SeverityLevelOrder.warning; break;
            case sarif.Result.level.open: sevOrder = SeverityLevelOrder.open; break;
            case sarif.Result.level.pass: sevOrder = SeverityLevelOrder.pass; break;
            case sarif.Result.level.notApplicable: sevOrder = SeverityLevelOrder.notApplicable; break;
            case sarif.Result.level.note: sevOrder = SeverityLevelOrder.note; break;
        }
        row.severityLevel = { isSeverity: true, severityLevelOrder: sevOrder, value: resultInfo.severityLevel };

        if (resultInfo.locations[0] !== undefined) {
            row.resultFile = { value: resultInfo.locations[0].fileName, tooltip: resultInfo.locations[0].uri.fsPath };
            const position = resultInfo.locations[0].range.start;
            row.resultStartPos = {
                pos: position,
                value: `(${position.line + 1},${position.character})`,
            };
        } else {
            row.resultFile = { value: "No Location" };
            row.resultStartPos = { pos: new Position(0, 0), value: `(0,0)` };
        }

        return row;
    }

    /**
     * Finds the result row in the resultslistrows that matches the ids(result and run id)
     * @param runId Run id, corresponding to the result info in the diagnostic
     * @param resultId Result id, corresponding to the result info in the diagnostic
     */
    private findMatchingRow(runId: number, resultId: number): number {
        return this.resultsListRows.findIndex((row, index) => {
            if (row.runId.value === runId && row.resultId.value === resultId) {
                return true;
            }

            return false;
        });
    }

    /**
     * Gets a set of the Resultslist data grouped and sorted based on the settings values
     */
    private getResultData(): ResultsListData {
        const data = {
            columns: this.columns,
            groupBy: this.groupBy,
            groups: [],
            resultCount: this.resultsListRows.length,
            sortBy: this.sortBy,
        } as ResultsListData;

        const groups = new Map<string, ResultsListGroup>();
        for (const row of this.resultsListRows) {
            const resultsListValue = (row[this.groupBy] as ResultsListValue);
            let key = resultsListValue.value;

            // special case for the columns that only show the file name of a uri, we need to sort on the full path
            if (this.groupBy === "sarifFile" || this.groupBy === "resultFile") {
                key = resultsListValue.tooltip;
            }

            if (groups.has(key)) {
                groups.get(key).rows.push(row);
            } else {
                groups.set(key, {
                    rows: [row], text: resultsListValue.value, tooltip: resultsListValue.tooltip,
                } as ResultsListGroup);
            }
        }

        data.groups = Array.from(groups.values());

        // sort groups by amount of rows per group
        data.groups.sort((a, b) => {
            return b.rows.length - a.rows.length;
        });

        // sort rows in each group
        for (const group of data.groups) {
            group.rows.sort((a, b) => {
                let comp: number;
                let valueA: ResultsListValue;
                let valueB: ResultsListValue;
                if (this.sortBy.ascending) {
                    valueA = a[this.sortBy.column];
                    valueB = b[this.sortBy.column];
                } else {
                    valueA = b[this.sortBy.column];
                    valueB = a[this.sortBy.column];
                }

                if (valueA.value === undefined) {
                    comp = -1;
                    if (valueB.value === undefined) {
                        comp = 0;
                    }
                } else if ((valueA as ResultsListPositionValue).pos !== undefined) {
                    const posA = (valueA as ResultsListPositionValue).pos;
                    const posB = (valueB as ResultsListPositionValue).pos;
                    comp = posA.line - posB.line;
                    if (comp === 0) {
                        comp = posA.character - posB.character;
                    }
                } else if ((valueA as ResultsListSeverityValue).isSeverity) {
                    comp = (valueA as ResultsListSeverityValue).severityLevelOrder -
                        (valueB as ResultsListSeverityValue).severityLevelOrder;
                } else if (typeof valueA.value === "number") {
                    comp = valueA.value - valueB.value;
                } else {
                    comp = valueA.value.localeCompare(valueB.value);
                }

                return comp;
            });
        }

        return data;
    }

    /**
     * Initializes the columns header values
     */
    private initializeColumns() {
        this.columns = {
            message: { description: "Result message", hide: false, title: "Message" } as ResultsListColumn,
            resultFile: { description: "Result file location ", hide: false, title: "File" } as ResultsListColumn,
            resultStartPos: {
                description: "Results position in the file", hide: false, title: "Position",
            } as ResultsListColumn,
            ruleId: { description: "Rule Id", hide: false, title: "Rule Id" } as ResultsListColumn,
            ruleName: { description: "Rule Name", hide: false, title: "Rule Name" } as ResultsListColumn,
            runId: {
                description: "Run Id generated based on order in the Sarif file", hide: false, title: "Run Id",
            } as ResultsListColumn,
            sarifFile: {
                description: "Sarif file the result data is from", hide: false, title: "Sarif File",
            } as ResultsListColumn,
            severityLevel: { description: "Severity Level", hide: false, title: "Severity" } as ResultsListColumn,
        };
    }
}
