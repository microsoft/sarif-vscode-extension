// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { action, autorun, computed, intercept, observable, observe, toJS, when } from 'mobx';
import { Log, PhysicalLocation, ReportingDescriptor, Result } from 'sarif';
import { augmentLog, CommandExtensionToPanel, filtersColumn, filtersRow, findResult, parseArtifactLocation, Visibility } from '../shared';
import '../shared/extension';
import { isActive } from './isActive';
import { ResultTableStore } from './resultTableStore';
import { Row, RowItem } from './tableStore';

export class IndexStore {
    @observable banner = '';

    private driverlessRules = new Map<string, ReportingDescriptor>();

    constructor(state: Record<string, Record<string, Record<string, Visibility>>>, workspaceUri?: string, defaultSelection?: boolean) {
        this.filtersRow = state.filtersRow;
        this.filtersColumn = state.filtersColumn;
        const setState = async () => {
            const {filtersRow, filtersColumn} = this;
            const state = { filtersRow: toJS(filtersRow), filtersColumn: toJS(filtersColumn) };
            await vscode.postMessage({ command: 'setState', state: JSON.stringify(state, null, '    ') });
            // PostMessage object key order unstable. Stringify is stable.
        };
        // Sadly unable to observe at the root.
        observe(this.filtersRow.Level, setState);
        observe(this.filtersRow.Baseline, setState);
        observe(this.filtersRow.Suppression, setState);
        observe(this.filtersColumn.Columns, setState);

        // `change` should be `IArrayWillSplice<Log>` but `intercept()` is not being inferred properly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        intercept(this.logs, (change: any) => {
            if (change.type !== 'splice') throw new Error(`Unexpected change type. ${change.type}`);
            change.added.forEach((log: Log) => {
                augmentLog(log, this.driverlessRules, workspaceUri);
            });
            return change;
        });

        observe(this.logs, () => {
            if (this.logs.length) return;
            this.selection.set(undefined);
        });

        if (defaultSelection) {
            const store = this.resultTableStoreByLocation;
            when(() => !!store.rows.length, () => {
                const item = store.rows.find(row => row instanceof RowItem) as RowItem<Result>;
                this.selection.set(item);
            });
        }

        autorun(() => {
            const selectedRow = this.selection.get();
            const result = selectedRow instanceof RowItem && selectedRow.item;
            if (!result?._uri) return; // Bail on no result or location-less result.
            postSelectArtifact(result, result.locations?.[0]?.physicalLocation);
        });
    }

    // Results
    @observable.shallow public logs = [] as Log[]
    @computed private get runs() {
        return this.logs.map(log => log.runs).flat();
    }
    @observable resultsFixed = [] as string[] // JSON string of ResultId. TODO: Migrate to set
    @computed public get results() {
        return this.runs.map(run => run.results ?? []).flat();
    }
    selection = observable.box<Row | undefined>(undefined)
    resultTableStoreByLocation = new ResultTableStore('File', result => result._relativeUri, this, this, this.selection)
    resultTableStoreByRule     = new ResultTableStore('Rule', result => result._rule,        this, this, this.selection)

    // Filters
    @observable keywords = ''
    @observable filtersRow = filtersRow
    @observable filtersColumn = filtersColumn
    @action public clearFilters() {
        this.keywords = '';
        for (const column in this.filtersRow) {
            for (const value in this.filtersRow[column]) {
                this.filtersRow[column][value] = 'visible';
            }
        }
    }

    // Tabs
    tabs = [
        { toString: () => 'Locations', store: this.resultTableStoreByLocation },
        { toString: () => 'Rules', store: this.resultTableStoreByRule },
        { toString: () => 'Logs', store: undefined },
    ] as { store: ResultTableStore<string | ReportingDescriptor> | undefined }[]
    selectedTab = observable.box(this.tabs[0], { deep: false })

    // Messages
    @action.bound public async onMessage(event: Pick<MessageEvent, 'data'>) {
        // During development while running via webpack-dev-server, we need to filter
        // out some development specific messages that would not occur in production.
        if (!event.data) return; // Ignore mysterious empty message
        if (event.data?.source) return; // Ignore 'react-devtools-*'
        if (event.data?.type) return; // Ignore 'webpackOk'

        const command = event.data?.command as CommandExtensionToPanel;

        if (command === 'select') {
            const {id} = event.data; // id undefined means deselect.
            if (!id) {
                this.selection.set(undefined);
            } else {
                const result = findResult(this.logs, id);
                if (!result) throw new Error('Unexpected: result undefined');
                this.selectedTab.get().store?.select(result);
            }
        }

        if (command === 'spliceLogs') {
            for (const uri of event.data.removed) {
                const i = this.logs.findIndex(log => log._uri === uri);
                if (i >= 0) this.logs.splice(i, 1);
            }
            for (const {text, uri, uriUpgraded, webviewUri} of event.data.added) {
                const log: Log = text
                    ? JSON.parse(text)
                    : await (await fetch(webviewUri)).json();
                log._uri = uri;
                log._uriUpgraded = uriUpgraded;
                this.logs.push(log);
            }
        }

        if (command === 'spliceResultsFixed') {
            for (const resultIdString of event.data.removed) {
                this.resultsFixed.remove(resultIdString);
            }
            for (const resultIdString of event.data.added) {
                this.resultsFixed.push(resultIdString);
            }
        }

        if (command === 'setBanner') {
            this.banner = event.data?.text ?? '';
        }
    }
}

export async function postLoad() {
    await vscode.postMessage({ command: 'load' });
}

export async function postSelectArtifact(result: Result, ploc?: PhysicalLocation) {
    // If this panel is not active, then any selection change did not originate from (a user's action) here.
    // It must have originated from (a user's action in) the editor, which then sent a message here.
    // If that is the case, don't send another 'select' message back. This would cause selection unstability.
    // The most common example is when the caret is moving, a selection-sync feedback loop will cause a range to
    // be selected in editor outside of the user's intent.
    if (!isActive()) return;

    if (!ploc) return;
    const log = result._log;
    const logUri = log._uri;
    const [uri, uriBase, uriContent] = parseArtifactLocation(result, ploc?.artifactLocation);
    const region = ploc?.region;
    await vscode.postMessage({ command: 'select', logUri, uri: uriContent ?? uri, uriBase, region, id: result._id });
}

export async function postSelectLog(result: Result) {
    await vscode.postMessage({ command: 'selectLog', id: result._id });
}

export async function postRefresh() {
    await vscode.postMessage({ command: 'refresh' });
}

export async function postRemoveResultFixed(result: Result) {
    await vscode.postMessage({ command: 'removeResultFixed', id: result._id });
}
