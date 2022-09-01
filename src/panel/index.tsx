// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { observable } from 'mobx';
import { observer } from 'mobx-react';
import * as React from 'react';
import { Component, Fragment } from 'react';
import { ReportingDescriptor } from 'sarif';
import 'vscode-codicons/dist/codicon.css';
import '../shared/extension';
import { Details } from './details';
import { FilterKeywordContext } from './filterKeywordContext';
import './index.scss';
import { IndexStore, postLoad, postRefresh } from './indexStore';
import { ResultTable } from './resultTable';
import { RowItem } from './tableStore';
import { Checkrow, Icon, Popover, ResizeHandle, Tab, TabPanel } from './widgets';
import { decodeFileUri } from '../shared';

export { React };
export * as ReactDOM from 'react-dom';
export { IndexStore as Store } from './indexStore';
export { DetailsLayouts } from './details.layouts';

@observer export class Index extends Component<{ store: IndexStore }> {
    private showFilterPopup = observable.box(false)
    private detailsPaneHeight = observable.box(300)

    render() {
        const {store} = this.props;
        const {banner} = store;

        const bannerElement = banner && <div className="svBanner">
            <Icon name="info" />
            <span style={{ flex: '1 1' }}>{banner}</span>
            <div className="svButton" onClick={() => postRefresh()}>
                Refresh results
            </div>
        </div>;

        if (!store.logs.length) {
            return <>
                {bannerElement}
                <div className="svZeroData">
                    <div className="svButton" onClick={() => vscode.postMessage({ command: 'open' })}>
                        Open SARIF log
                    </div>
                </div>
            </>;
        }

        const {logs, keywords} = store;
        const {showFilterPopup, detailsPaneHeight} = this;
        const activeTableStore = store.selectedTab.get().store;
        const allCollapsed = activeTableStore?.groupsFilteredSorted.every(group => !group.expanded) ?? false;
        const selectedRow = store.selection.get();
        const selected = selectedRow instanceof RowItem && selectedRow.item;
        return <FilterKeywordContext.Provider value={keywords ?? ''}>
            {bannerElement}
            <div className="svListPane">
                <TabPanel selection={store.selectedTab}
                    extras={<>
                        <div className="flexFill"></div>
                        <div className="svFilterCombo">
                            <input type="text" placeholder="Filter results" value={store.keywords}
                                onChange={e => store.keywords = e.target.value}
                                onKeyDown={e => { if (e.key === 'Escape') { store.keywords = ''; } } }/>
                            <Icon name="filter" title="Filter Options" onMouseDown={e => e.stopPropagation()} onClick={() => showFilterPopup.set(!showFilterPopup.get())} />
                        </div>
                        <Icon name={allCollapsed ? 'expand-all' : 'collapse-all'}
                            title={allCollapsed ? 'Expand All' : 'Collapse All'}
                            visible={!!activeTableStore}
                            onClick={() => activeTableStore?.groupsFilteredSorted.forEach(group => group.expanded = allCollapsed) } />
                        <Icon name="close-all"
                            title="Close All Logs"
                            visible={!activeTableStore}
                            onClick={() => vscode.postMessage({ command: 'closeAllLogs' })} />
                        <Icon name="folder-opened" title="Open Log" onClick={() => vscode.postMessage({ command: 'open' })} />
                    </>}>
                    <Tab name={store.tabs[0]} count={store.resultTableStoreByLocation.groupsFilteredSorted.length}>
                        <ResultTable store={store.resultTableStoreByLocation} onClearFilters={() => store.clearFilters()}
                            renderGroup={(title: string) => {
                                const {pathname} = new URL(title, 'file:');
                                return <>
                                    <span>{pathname.file || 'No Location'}</span>
                                    <span className="ellipsis svSecondary">{pathname.path}</span>
                                </>;
                            }} />
                    </Tab>
                    <Tab name={store.tabs[1]} count={store.resultTableStoreByRule.groupsFilteredSorted.length}>
                        <ResultTable store={store.resultTableStoreByRule} onClearFilters={() => store.clearFilters()}
                            renderGroup={(rule: ReportingDescriptor | undefined) => {
                                return <>
                                    <span>{rule?.name ?? '—'}</span>
                                    <span className="ellipsis svSecondary">{rule?.id ?? '—'}</span>
                                </>;
                            }} />
                    </Tab>
                    <Tab name={store.tabs[2]} count={logs.length}>
                        <div className="svLogsPane">
                            {logs.map((log, i) => {
                                const {pathname} = new URL(log._uri);
                                return <div key={i} className="svListItem">
                                    <div>{pathname.file}</div>
                                    <div className="ellipsis svSecondary">{decodeFileUri(log._uri)}</div>
                                    <Icon name="close" title="Close Log"
                                        onClick={() => vscode.postMessage({ command: 'closeLog', uri: log._uri })} />
                                </div>;
                            })}
                        </div>
                    </Tab>
                </TabPanel>
            </div>
            <div className="svResizer">
                <ResizeHandle size={detailsPaneHeight} />
            </div>
            <Details result={selected} resultsFixed={store.resultsFixed} height={detailsPaneHeight} />
            <Popover show={showFilterPopup} style={{ top: 35, right: 8 + 35 + 35 + 8 }}>
                {Object.entries(store.filtersRow).map(([name, state]) => <Fragment key={name}>
                    <div className="svPopoverTitle">{name}</div>
                    {Object.keys(state).map(name => <Checkrow key={name} label={name} state={state} />)}
                </Fragment>)}
                <div className="svPopoverDivider" />
                {Object.entries(store.filtersColumn).map(([name, state]) => <Fragment key={name}>
                    <div className="svPopoverTitle">{name}</div>
                    {Object.keys(state).map(name => <Checkrow key={name} label={name} state={state} />)}
                </Fragment>)}
            </Popover>
        </FilterKeywordContext.Provider>;
    }

    componentDidMount() {
        addEventListener('message', this.props.store.onMessage);
        postLoad();
    }

    componentWillUnmount() {
        removeEventListener('message', this.props.store.onMessage);
    }
}
