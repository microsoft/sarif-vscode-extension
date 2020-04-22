/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */
import * as nls from 'vscode-nls';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

import {
    ConfigurationChangeEvent, Disposable, Position, Selection, TextEditorRevealType, ViewColumn, window, workspace,
    WorkspaceConfiguration, Uri, TextDocument, TextEditor, commands
} from "vscode";
import { BaselineOrder, KindOrder, MessageType, SeverityLevelOrder } from "./common/enums";
import {
    ResultInfo, ResultsListColumn, ResultsListData, ResultsListGroup, ResultsListRow, ResultsListSortBy, ResultsListValue,
    WebviewMessage, Location, RunInfo
} from "./common/interfaces";
import { ExplorerController, PostMessageOptions } from "./explorerController";
import { SVCodeActionProvider } from "./svCodeActionProvider";
import { SVDiagnosticCollection, SVDiagnosticsChangedEvent } from "./svDiagnosticCollection";
import { Utilities } from "./utilities";
import { SarifViewerVsCodeDiagnostic } from "./sarifViewerDiagnostic";
import { isResultsListPositionValue, isResultsListCustomOrderValue, isResultsListStringValue, isResultsListNumberValue } from './common/resultValueHelpers';

/**
 * Class that acts as the data controller for the ResultsList in the Sarif Explorer
 */
export class ResultsListController implements Disposable {
    private disposables: Disposable[] = [];

    private columns: { [key: string]: ResultsListColumn } = {};

    private groupBy: string = ResultsListController.defaultGroupBy;
    private static defaultGroupBy: string = 'resultFile';

    private static defaultSortBy: ResultsListSortBy = {
        ascending: true,
        column: 'severityLevel'
    };
    private sortBy: ResultsListSortBy = ResultsListController.defaultSortBy;

    private resultsListRows: Map<string, ResultsListRow>;

    private filterCaseMatch: boolean;
    private filterText: string;
    private postFilterListRows: string[];

    private readonly configHideColumns = 'resultsListHideColumns';
    private readonly configGroupBy = 'resultsListGroupBy';
    private readonly configSortBy = 'resultsListSortBy';

    public constructor(private readonly explorerController: ExplorerController,
                       private readonly codeActionProvider: SVCodeActionProvider,
                       private readonly diagnosticCollection: SVDiagnosticCollection) {
        this.resultsListRows = new Map<string, ResultsListRow>();
        this.postFilterListRows = [];
        this.filterCaseMatch = false;
        this.filterText = '';
        this.initializeColumns();
        this.onSettingsChanged({ affectsConfiguration: (section: string, resource?: Uri) => true});
        this.disposables.push(workspace.onDidChangeConfiguration(this.onSettingsChanged, this));
        this.disposables.push(explorerController.onWebViewMessage(this.onResultsListMessage.bind(this)));
        this.disposables.push(diagnosticCollection.diagnosticCollectionChanged(this.onDiagnosticCollectionChanged.bind(this)));
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * Updates the Results List data set with the array of diags, it either adds, updates, or removes(if flag is set)
     * @param diags Array of diags that need to be updated
     * @param remove flag to remove the diags in the array, otherwise they will be udpated
     */
    public updateResultsListData(diagnosticsChangedEvent: SVDiagnosticsChangedEvent): void {
        if (!diagnosticsChangedEvent.diagnostics) {
            throw new Error ('Should always have changed diagnostics');
        }

        if (diagnosticsChangedEvent.type === 'Remove') {
            for (const key of diagnosticsChangedEvent.diagnostics.keys()) {
                const id: string = `${diagnosticsChangedEvent.diagnostics[key].resultInfo.runId}_${diagnosticsChangedEvent.diagnostics[key].resultInfo.id}`;
                this.resultsListRows.delete(id);
                const index: number = this.postFilterListRows.indexOf(id);
                if (index !== -1) {
                    this.postFilterListRows.splice(index, 1);
                }
            }
        } else {
            const regEx: RegExp = this.generateFilterRegExp();
            for (const key of diagnosticsChangedEvent.diagnostics.keys()) {
                const row: ResultsListRow = this.createResultsListRow(diagnosticsChangedEvent.diagnostics[key].resultInfo);
                const id: string = `${row.runId.value}_${row.resultId.value}`;
                this.resultsListRows.set(id, row);

                const index: number = this.postFilterListRows.indexOf(id);
                if (this.applyFilterToRow(row, regEx)) {
                    if (index === -1) {
                        this.postFilterListRows.push(id);
                    }
                } else if (index !== -1) {
                    this.postFilterListRows.splice(index, 1);
                }
            }
        }
    }

    /**
     * Called by the ExplorerController when a message comes from the results list in the webview
     * @param msg message from the web view
     */
    public async onResultsListMessage(msg: WebviewMessage): Promise<void> {
        const sarifConfig: WorkspaceConfiguration = workspace.getConfiguration(Utilities.configSection);
        switch (msg.type) {
            case MessageType.ResultsListColumnToggled:
                const hideColsConfig: string[] = sarifConfig.get(this.configHideColumns, []);
                const index: number = hideColsConfig.indexOf(msg.data);
                if (index !== -1) {
                    hideColsConfig.splice(index, 1);
                } else {
                    hideColsConfig.push(msg.data);
                }
                await sarifConfig.update(this.configHideColumns, hideColsConfig, true);
                break;

            case MessageType.ResultsListFilterApplied:
                const input: string = msg.data.trim();
                if (input !== this.filterText) {
                    this.filterText = input;
                    this.updateFilteredRowsList();
                    this.postDataToExplorer('Should already be open');
                }
                break;

            case MessageType.ResultsListFilterCaseToggled:
                this.filterCaseMatch = !this.filterCaseMatch;
                this.updateFilteredRowsList();
                this.postDataToExplorer('Should already be open');
                break;

            case MessageType.ResultsListGroupChanged:
                let groupByConfig: string | undefined = sarifConfig.get(this.configGroupBy);
                if (groupByConfig !== msg.data) {
                    groupByConfig = msg.data;
                }
                await sarifConfig.update(this.configGroupBy, groupByConfig, true);
                break;

            case MessageType.ResultsListResultSelected:
                // What is the proper type of "id"?
                const id: { resultId: number; runId: number} = JSON.parse(msg.data);
                const diagnostic: SarifViewerVsCodeDiagnostic | undefined = this.diagnosticCollection.getResultInfo(id.resultId, id.runId);
                if (!diagnostic) {
                    break;
                }

                if (!diagnostic.resultInfo.assignedLocation) {
                    return;
                }

                // Attempt to map the result if it hasn't been mapped
                const diagLocation: Location = diagnostic.resultInfo.assignedLocation;
                if (!diagLocation.uri) {
                    return;
                }

                const uriToOpen: Uri | undefined = await diagLocation.mapLocationToLocalPath({ promptUser: true });

                if (!uriToOpen) {
                    return;
                }

                const textDocument: TextDocument = await workspace.openTextDocument(uriToOpen);
                // Just because we are switching results, it does not mean we ant to steal focus :) Leave it alone.
                const textEditor: TextEditor = await window.showTextDocument(textDocument, ViewColumn.One, /*preserveFocus*/ true);
                textEditor.revealRange(diagLocation.range, TextEditorRevealType.InCenterIfOutsideViewport);
                textEditor.selection = new Selection(diagLocation.range.start, diagLocation.range.end);
                await this.codeActionProvider.provideCodeActions(textDocument, diagLocation.range, { diagnostics: [diagnostic] });

                if (textDocument.languageId === 'markdown' &&
                    workspace.getConfiguration(Utilities.configSection).get('openMarkdownPreview', false)) {
                    await commands.executeCommand('markdown.showPreviewToSide', uriToOpen);
                }
                break;

            case MessageType.ResultsListSortChanged:
                const sortByConfig: ResultsListSortBy = sarifConfig.get(this.configSortBy, {
                    ascending: true,
                    column: msg.data
                });

                if (sortByConfig.column === msg.data) {
                    sortByConfig.ascending = !sortByConfig.ascending;
                }

                await sarifConfig.update(this.configSortBy, sortByConfig, true);
                break;
        }
    }

    /**
     * Event handler when settings are changed, handles hide columns, groupby, and sortby changes
     * @param event configuration change event
     */
    public onSettingsChanged(event: ConfigurationChangeEvent): void {
        if (event.affectsConfiguration(Utilities.configSection)) {
            const sarifConfig: WorkspaceConfiguration = workspace.getConfiguration(Utilities.configSection);

            let changed: boolean = false;
            if (this.checkIfColumnsChanged(sarifConfig)) {
                changed = true;
            }
            if (this.checkIfGroupByChanged(sarifConfig)) {
                changed = true;
            }
            if (this.checkIfSortByChanged(sarifConfig)) {
                changed = true;
            }

            if (changed) {
                this.postDataToExplorer('Only if open');
            }
        }
    }

    /**
     * Gets the latest Result data, grouped and sorted and sends it to the Explorer Controller to send to the Explorer
     * @param options Controls if the explorer should be opened if not already opened.
     */
    public postDataToExplorer(option: PostMessageOptions): void {
        const data: ResultsListData = this.getResultData();
        this.explorerController.setResultsListData(data, option);
    }

    /**
     * Checks if the hide columns have changed in the settings
     * @param sarifConfig config object with the sarif settings
     */
    private checkIfColumnsChanged(sarifConfig: WorkspaceConfiguration): boolean {
        let changed: boolean = false;
        const hideCols: string[] = sarifConfig.get(this.configHideColumns, []);

        for (const col in this.columns) {
            if (this.columns.hasOwnProperty(col)) {
                let shouldHide: boolean = false;
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
        let changed: boolean = false;
        const group: string = sarifConfig.get(this.configGroupBy, ResultsListController.defaultGroupBy);

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
        let changed: boolean = false;
        const sort: ResultsListSortBy  = sarifConfig.get(this.configSortBy, ResultsListController.defaultSortBy);

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

        const run: RunInfo | undefined = this.diagnosticCollection.getRunInfo(resultInfo.runId);

        let baselineOrder: BaselineOrder = BaselineOrder.absent;
        switch (resultInfo.baselineState) {
            case 'absent': baselineOrder = BaselineOrder.absent; break;
            case 'new': baselineOrder = BaselineOrder.new; break;
            case 'unchanged': baselineOrder = BaselineOrder.unchanged; break;
            case 'updated': baselineOrder = BaselineOrder.updated; break;
        }

        let kindOrder: KindOrder = KindOrder.fail;
        switch (resultInfo.kind) {
            case 'fail': kindOrder = KindOrder.fail; break;
            case 'notApplicable': kindOrder = KindOrder.notApplicable; break;
            case 'open': kindOrder = KindOrder.open; break;
            case 'pass': kindOrder = KindOrder.pass; break;
            case 'review': kindOrder = KindOrder.review; break;
        }

        let sevOrder: SeverityLevelOrder = SeverityLevelOrder.error;
        switch (resultInfo.severityLevel) {
            case 'error': sevOrder = SeverityLevelOrder.error; break;
            case 'warning': sevOrder = SeverityLevelOrder.warning; break;
            case 'none': sevOrder = SeverityLevelOrder.none; break;
            case 'note': sevOrder = SeverityLevelOrder.note; break;
        }

        let resultFileName: string | undefined;
        let resultFsPath: string | undefined;
        let logicalLocation: string | undefined;
        let startPosition: Position | undefined;
        let startPositionString: string | undefined;

        if (resultInfo.locations[0]) {
            const loc: Location = resultInfo.locations[0];
            if (loc.uri) {
                resultFileName = loc.fileName;
                resultFsPath = loc.uri.fsPath;

                startPosition = loc.range.start;
                startPositionString = `(${startPosition.line + 1}, ${startPosition.character + 1})`;
            }

            if (loc.logicalLocations) {
                logicalLocation = loc.logicalLocations[0];
            }
        }

        return {
            baselineState: { kind: 'Custom Order', customOrderType: 'Baseline', order: baselineOrder, value: resultInfo.baselineState },
            kind: { kind: 'Custom Order', customOrderType: 'Kind', order: kindOrder, value: resultInfo.kind },
            severityLevel: { kind: 'Custom Order', customOrderType: 'Severity', order: sevOrder, value: resultInfo.severityLevel },
            message: { kind: 'String', value: resultInfo.message.text },
            resultStartPos:  {kind: 'Position', pos: startPosition, value: startPositionString },
            resultId: { kind: 'Number', value: resultInfo.id },
            ruleId: { kind: 'String', value: resultInfo.ruleId },
            ruleName: { kind: 'String', value: resultInfo.ruleName },
            runId: { kind: 'Number', value: resultInfo.runId },
            automationCat: { kind: 'String', value: run && run.automationCategory },
            automationId:  { kind: 'String', value: run && run.automationIdentifier },
            sarifFile: { kind: 'String', value: run && run.sarifFileName, tooltip: run && run.sarifFileFullPath },
            tool: { kind: 'String', value: run && run.toolName, tooltip: run && run.toolFullName },
            resultFile: { kind: 'String', tooltip: resultFsPath, value: resultFileName },
            logicalLocation: { kind: 'String', value: logicalLocation },
            rank: { kind: 'Number', value: resultInfo.rank },
        };
    }

    /**
     * Applies the latest filter text and settings to the resultslistrows and adds any matching rows to filteredlistrows
     */
    private updateFilteredRowsList(): void {
        this.postFilterListRows = [];

        const regEx: RegExp = this.generateFilterRegExp();

        this.resultsListRows.forEach((row: ResultsListRow, key: string) => {
            if (this.filterText === '' || this.applyFilterToRow(row, regEx)) {
                this.postFilterListRows.push(key);
            }
        });
    }

    /**
     * Applies the filter regexp to certian columns in the passed in row, if any match returns true
     * @param row Row that is being checked for a filter match
     * @param regExp RegExp based on the filter settings, use generateFilterRegex() to create
     */
    private applyFilterToRow(row: ResultsListRow, regExp: RegExp): boolean {
        if ((row['automationCat'].value && regExp.test(row['automationCat'].value)) ||
            (row['automationId'].value && regExp.test(row['automationId'].value)) ||
            (row['baselineState'].value && regExp.test(row['baselineState'].value)) ||
            (row['message'].value && regExp.test(row['message'].value)) ||
            (row['ruleId'].value && regExp.test(row['ruleId'].value)) ||
            (row['ruleName'].value && regExp.test(row['ruleName'].value)) ||
            (row['severityLevel'].value && regExp.test(row['severityLevel'].value)) ||
            (row['kind'].value && regExp.test(row['kind'].value)) ||
            (row['resultFile'].value && regExp.test(row['resultFile'].value)) ||
            (row['sarifFile'].value && regExp.test(row['sarifFile'].value)) ||
            (row['tool'].value && regExp.test(row['tool'].value)) ||
            (row['logicalLocation'].value && regExp.test(row['logicalLocation'].value))) {
            return true;
        }

        return false;
    }

    /**
     * generates the filter regexp based on the filter settings and text
     */
    private generateFilterRegExp(): RegExp {
        let flags: string | undefined;
        if (!this.filterCaseMatch) {
            flags = 'i';
        }

        const pattern: string = this.filterText !== '' ? this.filterText : '.*';

        return new RegExp(pattern, flags);
    }

    /**
     * Gets a set of the Resultslist data grouped and sorted based on the settings values
     */
    private getResultData(): ResultsListData {
        const data: ResultsListData = {
            columns: this.columns,
            filterCaseMatch: this.filterCaseMatch,
            filterText: this.filterText,
            groupBy: this.groupBy,
            groups: [],
            resultCount: this.resultsListRows.size,
            sortBy: this.sortBy,
        };

        const groups: Map<string, ResultsListGroup> = new Map<string, ResultsListGroup>();
        for (const postFilterRow of this.postFilterListRows) {
            const row: ResultsListRow | undefined = this.resultsListRows.get(postFilterRow);
            if (!row) {
                continue;
            }

            const resultsListValue: ResultsListValue | undefined = row[this.groupBy];
            if (!resultsListValue) {
                continue;
            }

            // tslint:disable-next-line: no-any
            let key: any = resultsListValue.value;

            // special case for the columns that only show the file name of a uri, we need to sort on the full path
            if (this.groupBy === 'sarifFile' || this.groupBy === 'resultFile') {
                key = resultsListValue.tooltip;
            }

            const resultsListGroup: ResultsListGroup | undefined = groups.get(key);
            if (resultsListGroup) {
                resultsListGroup.rows.push(row);
            } else {
                groups.set(key, {
                    rows: [row], text: resultsListValue.value, tooltip: resultsListValue.tooltip,
                });
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
                let comp: number = 0;
                let valueA: ResultsListValue | undefined;
                let valueB: ResultsListValue | undefined;
                if (this.sortBy.ascending) {
                    valueA = a[this.sortBy.column];
                    valueB = b[this.sortBy.column];
                } else {
                    valueA = b[this.sortBy.column];
                    valueB = a[this.sortBy.column];
                }

                if (valueA === undefined || valueB === undefined) {
                    if (valueA === undefined && valueB === undefined) {
                        comp = 0;
                    } else if (valueB === undefined) {
                        comp = 1;
                    } else {
                        comp = -1;
                    }
                } else if (valueA.value === undefined || valueB.value === undefined) {
                    if (valueA.value === undefined && valueB.value === undefined) {
                        comp = 0;
                    } else if (valueB.value === undefined) {
                        comp = 1;
                    } else {
                        comp = -1;
                    }
                } else if (isResultsListPositionValue(valueA) && isResultsListPositionValue(valueB)) {
                    const posA: Position = valueA.pos || new Position(0, 0);
                    const posB: Position = valueB.pos || new Position(0, 0);
                    comp = posA.line - posB.line;
                    if (comp === 0) {
                        comp = posA.character - posB.character;
                    }
                } else if (isResultsListCustomOrderValue(valueA) && isResultsListCustomOrderValue(valueB)) {
                    comp = valueA.order - valueB.order;
                } else if (isResultsListNumberValue(valueA) && isResultsListNumberValue(valueB)) {
                    comp = valueA.value - valueB.value;
                } else if (isResultsListStringValue(valueA) && isResultsListStringValue(valueB)) {
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
    private initializeColumns(): void {
        this.columns = {
            baselineState: {
                description:  localize('column.baselineState.description', "The state of a result relative to a baseline of a previous run."),
                title: localize('column.baselineState.title', "Baseline"),
                hide: false,
            },

            message: {
                description: localize('column.message.description', "Result message"),
                title: localize('column.message.title', "Result message"),
                hide: false,
            },

            resultFile: {
                description: localize('column.resultFile.description', "Result file location"),
                title: localize('column.resultFile.title', "File"),
                hide: false,
            },

            resultStartPos: {
                description: localize('column.resultStartPos.description', "Results position in the file"),
                title: localize('"column.resultStartPos.title', "Position"),
                hide: false,
            },

            logicalLocation: {
                description: localize('column.logicalLocation.description', "Logical Location"),
                title: localize('column.logicalLocation.title', "Logical Location"),
                hide: false,
            },

            ruleId: {
                description: localize('column.ruleId.description', "Rule Id"),
                title: localize('column.ruleId.title', "Rule Id"),
                hide: false,
            },

            ruleName: {
                description: localize('column.ruleName.description', "Rule Name"),
                title: localize('column.ruleName.title', "Rule Name"),
                hide: false,
            },

            runId: {
                description: localize('column.runId.description', "Run Id generated based on order in the Sarif file"),
                title: localize('column.runId.title', "Run Id"),
                hide: false,
            },

            sarifFile: {
                description: localize('column.sarifFile.description', "Sarif file the result data is from"),
                title: localize('column.sarifFile.title', "Sarif File"),
                hide: false,
            },

            severityLevel: {
                description: localize('column.severityLevel.description', "Severity Level"),
                title: localize('column.severityLevel.title', "Severity"),
                hide: false,
            },

            kind: {
                description: localize('column.kind.description', "Specifies the nature of the result"),
                title: localize('column.kind.title', "Kind"),
                hide: false,
            },

            rank: {
                description: localize('column.rank.description', "Value representing the priority or importance of the result"),
                title: localize('column.rank.title', "Rank"),
                hide: false,
            },

            tool: {
                description: localize('column.tool.description', "Name of the analysis tool that generated the result"),
                title: localize('column.tool.title', "Tool"),
                hide: false,
            },

            automationCat: {
                description: localize('column.automationCat.description', "The automation category this results run belongs to"),
                title: localize('column.automationCat.title', "Automation Category"),
                hide: false,
            },

            automationId: {
                description: localize('column.automationId.description', "The unique automation id of this results run, used within the automation category if present"),
                title: localize('column.automationId.title', "Automation Id"),
                hide: false,
            }
        };
    }

    private onDiagnosticCollectionChanged(diagnosticChangeEvent: SVDiagnosticsChangedEvent): void {
    switch (diagnosticChangeEvent.type) {
        case 'Synchronize':
            this.postDataToExplorer('Always Open');
            break;

        case 'Add':
        case 'Remove':
            this.updateResultsListData(diagnosticChangeEvent);
            break;
        }
    }
}
