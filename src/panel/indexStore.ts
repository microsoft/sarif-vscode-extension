// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { action, autorun, computed, intercept, observable, observe, toJS, when } from 'mobx';
import { Log, PhysicalLocation, ReportingDescriptor, Result } from 'sarif';
import { augmentLog, CommandExtensionToPanel, filtersColumn, filtersRow, parseArtifactLocation, Visibility } from '../shared';
import '../shared/extension';
import { overrideBaseUri } from '../shared/overrideBaseUri';
import { isActive } from './isActive';
import { ResultTableStore } from './resultTableStore';
import { Row, RowItem } from './tableStore';

export class IndexStore {
    private driverlessRules = new Map<string, ReportingDescriptor>();

    constructor(state: Record<string, Record<string, Record<string, Visibility>>>, workspaceUri?: string, defaultSelection?: boolean) {
        this.filtersRow = state.filtersRow;
        this.filtersColumn = state.filtersColumn;
        const setState = () => {
            const {filtersRow, filtersColumn} = this;
            const state = { filtersRow: toJS(filtersRow), filtersColumn: toJS(filtersColumn) };
            vscode.postMessage({ command: 'setState', state: JSON.stringify(state, null, '    ') });
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
                overrideBaseUri(log, workspaceUri);
                augmentLog(log, this.driverlessRules);
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
    @computed public get results() {
        return this.runs.map(run => run.results || []).flat();
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
    @action.bound public async onMessage(event: MessageEvent) {
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
                const [logUri, runIndex, resultIndex] = id;
                const result = this.logs.find(log => log._uri === logUri)?.runs[runIndex]?.results?.[resultIndex];
                if (!result) throw new Error('Unexpected: result undefined');
                this.selectedTab.get().store?.select(result);
            }
        }

        if (command === 'spliceLogs') {
            for (const uri of event.data.removed) {
                const i = this.logs.findIndex(log => log._uri === uri);
                if (i >= 0) this.logs.splice(i, 1);
            }
            for (const {uri, uriUpgraded, webviewUri} of event.data.added) {
                const response = await fetch(webviewUri);
                const log = await response.json() as Log;
                log._uri = uri;
                log._uriUpgraded = uriUpgraded;
                this.logs.push(log);
            }
        }
    }
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
    const [uri, uriContent] = parseArtifactLocation(result, ploc?.artifactLocation);
    const region = ploc?.region;
    await vscode.postMessage({ command: 'select', logUri, uri: uriContent ?? uri, region });
}

export async function postSelectLog(result: Result) {
    await vscode.postMessage({ command: 'selectLog', id: result._id });
}
