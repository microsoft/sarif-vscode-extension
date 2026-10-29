// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable indent */ // Allowing for some custom intent under svDetailsGrid 2D layout.

import { autorun, computed, IObservableValue, observable } from 'mobx';
import { observer } from 'mobx-react';
import * as React from 'react';
import { Component, Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import { Location, Result, StackFrame, ThreadFlowLocation } from 'sarif';
import { parseArtifactLocation, parseLocation, decodeFileUri } from '../shared';
import './details.scss';
import './index.scss';
import { postRemoveResultFixed, postSelectArtifact, postSelectLog } from './indexStore';
import { buildTraceItems, isCollapsedTraceGroup, traceBaseNestingLevel, traceImportance, TraceItem, traceNestingDepth } from './traceView';
import { css, List, Tab, TabPanel, renderMessageTextWithEmbeddedLinks } from './widgets';

// ReactMarkdown blocks `vscode:` and `command:` URIs by default. This is a workaround.
// vscode scheme: https://code.visualstudio.com/api/references/vscode-api#window.registerUriHandler
// command scheme: https://code.visualstudio.com/api/extension-guides/command#command-uris
function uriTransformer(uri: string) {
    if (uri.startsWith('vscode:') || uri.startsWith('command:')) return uri;
    return ReactMarkdown.uriTransformer(uri);
}

type TabName = 'Info' | 'Analysis Steps';

interface DetailsProps { result: Result, resultsFixed: string[], height: IObservableValue<number> }
@observer export class Details extends Component<DetailsProps> {
    private selectedTab = observable.box<TabName>('Info')
    private showAllAnalysisSteps = observable.box(false)
    private expandedTraceGroups = observable.set<string>()
    private analysisStepSelection = observable.box<TraceItem | undefined>(undefined, { deep: false })
    private disposers: (() => void)[] = []

    @computed private get threadFlowLocations(): ThreadFlowLocation[] {
		return this.props.result?.codeFlows?.[0]?.threadFlows?.[0].locations ?? [];
	}
    @computed private get stacks() {
        return this.props.result?.stacks;
    }
    constructor(props: DetailsProps) {
        super(props);
        this.disposers.push(autorun(() => {
            const hasThreadFlows = !!this.threadFlowLocations.length;
            this.selectedTab.set(hasThreadFlows ? 'Analysis Steps' : 'Info');
        }));
        this.disposers.push(this.analysisStepSelection.observe(change => {
            const item = change.newValue;
            if (!item || isCollapsedTraceGroup(item)) return;
            postSelectArtifact(this.props.result, item.location?.physicalLocation);
        }));
    }
    componentDidUpdate(prevProps: DetailsProps) {
        if (prevProps.result === this.props.result) return;
        this.showAllAnalysisSteps.set(false);
        this.expandedTraceGroups.clear();
        this.analysisStepSelection.set(undefined);
        this.selectedTab.set(this.threadFlowLocations.length ? 'Analysis Steps' : 'Info');
    }
    componentWillUnmount() {
        this.disposers.forEach(dispose => dispose());
    }
    render() {
        const renderRuleDesc = (result: Result) => {
            const desc = result?._rule?.fullDescription ?? result?._rule?.shortDescription;
            if (!desc) return '—';
            return desc.markdown
                ? <ReactMarkdown className="svMarkDown" source={desc.markdown} transformLinkUri={uriTransformer} />
                : renderMessageTextWithEmbeddedLinks(desc.text, result, vscode.postMessage);
        };

        const renderSuppressionInformation = (result: Result) => {
            const text = result._suppression;
            const justification = result._justification;
            if (!text && !justification) {
                return '—'; // unreachable
            }
            if (!justification) {
                return text;
            }
            return `${text}: ${justification}`;
        };

        const {result, resultsFixed, height} = this.props;
        const helpUri = result?._rule?.helpUri;
        const traceLocations = this.threadFlowLocations;
        const showAllAnalysisSteps = this.showAllAnalysisSteps.get();
        const traceItems = buildTraceItems(traceLocations, showAllAnalysisSteps, this.expandedTraceGroups);
        const unimportantStepCount = traceLocations.filter(location => traceImportance(location) === 'unimportant').length;
        const baseNestingLevel = traceBaseNestingLevel(traceLocations);

        return <div className="svDetailsPane" style={{ height: height.get() }}>
            {result && <TabPanel selection={this.selectedTab}>
                <Tab name="Info">
                    <div className="svDetailsBody svDetailsInfo">
                        {resultsFixed.includes(JSON.stringify(result._id)) && <div className="svDetailsMessage">
                            This result has been marked as fixed.&nbsp;
                            <a href="#" onClick={e => {
                                e.preventDefault(); // Cancel # nav.
                                postRemoveResultFixed(result);
                            }}>Clear</a>.
                        </div>}
                        <div className="svDetailsMessage">
                            {result._markdown
                                ? <ReactMarkdown className="svMarkDown" source={result._markdown} transformLinkUri={uriTransformer} />
                                : renderMessageTextWithEmbeddedLinks(result._message, result, vscode.postMessage)}</div>
                        <div className="svDetailsGrid">
                            <span>Rule Id</span>			{helpUri ? <a href={helpUri} target="_blank" rel="noopener noreferrer">{result.ruleId}</a> : <span>{result.ruleId}</span>}
                            <span>Rule Name</span>			<span>{result._rule?.name ?? '—'}</span>
                            <span>Rule Description</span>	<span>{renderRuleDesc(result)}</span>
                            <span>Level</span>				<span>{result.level}</span>
                            <span>Kind</span>				<span>{result.kind ?? '—'}</span>
                            <span>Baseline State</span>		<span>{result.baselineState}</span>
                            <span>Locations</span>			<span className="svDetailsGridLocations">
                                                                {result.locations?.map((loc, i) => {
                                                                    const ploc = loc.physicalLocation;
                                                                    const [uri] = parseArtifactLocation(result, ploc?.artifactLocation);
                                                                    return <a key={i} href="#" className="ellipsis" title={uri}
                                                                        onClick={e => {
                                                                            e.preventDefault(); // Cancel # nav.
                                                                            postSelectArtifact(result, ploc);
                                                                        }}>
                                                                        {uri?.file ?? '-'}
                                                                    </a>;
                                                                }) ?? <span>—</span>}
                                                            </span>
                            <span>Log</span>				<a href="#" title={decodeFileUri(result._log._uri)}
                                                                onClick={e => {
                                                                    e.preventDefault(); // Cancel # nav.
                                                                    postSelectLog(result);
                                                                }}>
                                                                {result._log._uri.file}{result._log._uriUpgraded && ' (upgraded)'}
                                                            </a>
                            <span>Suppression</span>        <span>{renderSuppressionInformation(result)}</span>
                            {(() => {
                                // Rendering "tags" reserved for a future release.
                                const { tags, ...rest } = result.properties ?? {};
                                return <>
                                    <span>&nbsp;</span><span></span>{/* Blank separator line */}
                                    {Object.entries(rest).map(([key, value]) => {
                                        return <Fragment key={key}>
                                            <span className="ellipsis">{key}</span>
                                            <span>{(() => {
                                                if (key === 'github/alertUrl' && typeof value === 'string') {
                                                    const href = value
                                                        .replace('api.github.com/repos', 'github.com')
                                                        .replace('/code-scanning/alerts', '/security/code-scanning');
                                                    return <a href={href}>{href}</a>;
                                                }
                                                if (value === null)
                                                    return '—';
                                                if (Array.isArray(value))
                                                    return <span style={{ whiteSpace: 'pre' }}>{value.join('\n')}</span>;
                                                if (typeof value === 'boolean')
                                                    return JSON.stringify(value, null, 2);
                                                if (typeof value === 'object')
                                                    return <pre style={{ margin: 0, fontSize: '0.7rem' }}><code>{JSON.stringify(value, null, 2)}</code></pre>;
                                                return value;
                                            })()}</span>
                                        </Fragment>;
                                    })}
                                </>;
                            })()}
                        </div>
                    </div>
                </Tab>
                <Tab name="Analysis Steps" count={this.threadFlowLocations.length}>
                    <div className="svDetailsBody svDetailsCodeflowAndStacks svDetailsTrace">
                        <div className="svTraceToolbar">
                            <span className="svSecondary">
                                {showAllAnalysisSteps
                                    ? `${traceLocations.length} steps`
                                    : `${traceLocations.length - unimportantStepCount} key steps`}
                            </span>
                            {unimportantStepCount > 0 && <button onClick={() => {
                                if (showAllAnalysisSteps) {
                                    this.expandedTraceGroups.clear();
                                    const selection = this.analysisStepSelection.get();
                                    if (selection && !isCollapsedTraceGroup(selection) && traceImportance(selection) === 'unimportant') {
                                        this.analysisStepSelection.set(undefined);
                                    }
                                }
                                this.showAllAnalysisSteps.set(!showAllAnalysisSteps);
                            }}>
                                {showAllAnalysisSteps
                                    ? 'Hide unimportant steps'
                                    : `Show full trace (${unimportantStepCount})`}
                            </button>}
                        </div>
                        {(() => {
                            const renderTraceItem = (item: TraceItem) => {
                                if (isCollapsedTraceGroup(item)) {
                                    const expanded = this.expandedTraceGroups.has(item.key);
                                    return <div className="svTraceCollapsed">
                                        <button aria-expanded={expanded} onClick={event => {
                                            event.stopPropagation();
                                            if (expanded) this.expandedTraceGroups.delete(item.key);
                                            else this.expandedTraceGroups.add(item.key);
                                        }}>
                                            {expanded ? 'Hide' : 'Show'} {item.locations.length} unimportant {item.locations.length === 1 ? 'step' : 'steps'}
                                        </button>
                                    </div>;
                                }

                                const importance = traceImportance(item);
                                const depth = traceNestingDepth(item, baseNestingLevel);
                                const { message, uri, region } = parseLocation(result, item.location);
                                const stepNumber = traceLocations.indexOf(item) + 1;
                                return <>
                                    <div className={css('svTraceMessage', `svTrace-${importance}`)} title={`Step ${stepNumber}: ${message ?? '—'}`}>
                                        <span className="svTraceIndent" aria-hidden="true">
                                            {Array.from({ length: depth }, (_, i) => <span key={i}></span>)}
                                        </span>
                                        <span className="svTraceStepNumber">{stepNumber}</span>
                                        <span className="svTraceText">{message ?? '—'}</span>
                                        {!!item.kinds?.length && <span className="svTraceKinds">
                                            {item.kinds.map(kind => <span className="svTraceKind" key={kind}>{kind}</span>)}
                                        </span>}
                                    </div>
                                    <div className="svSecondary">{uri?.file ?? '—'}</div>
                                    <div className="svLineNum">{region?.startLine}:{region?.startColumn ?? 1}</div>
                                </>;
                            };

                            return <List items={traceItems} renderItem={renderTraceItem} selection={this.analysisStepSelection}
                                isSelectable={item => !isCollapsedTraceGroup(item)}
                                itemKey={(item, i) => isCollapsedTraceGroup(item) ? `collapsed-${item.key}` : `step-${traceLocations.indexOf(item)}-${i}`}
                                allowClear>
                                <span className="svSecondary">No analysis steps in selected result.</span>
                            </List>;
                        })()}
                    </div>
                </Tab>
                <Tab name="Stacks" count={this.stacks?.length || 0}>
                    <div className="svDetailsBody">
                        {(() => {
                            if (!this.stacks?.length)
                                return <div className="svZeroData">
                                    <span className="svSecondary">No stacks in selected result.</span>
                                </div>;

                            const renderStack = (stackFrame: StackFrame) => {
                                const location = stackFrame.location;
                                const logicalLocation = stackFrame.location?.logicalLocations?.[0];
                                const { message, uri, region } = parseLocation(result, location);
                                const text = `${message ?? ''} ${logicalLocation?.fullyQualifiedName ?? ''}`;
                                return <>
                                    <div className="ellipsis">{text ?? '—'}</div>
                                    <div className="svSecondary">{uri?.file ?? '—'}</div>
                                    <div className="svLineNum">{region?.startLine}:1</div>
                                </>;
                            };

                            return this.stacks.map((stack, key) => {
                                const stackFrames = stack.frames;

                                const selection = observable.box<StackFrame | undefined>(undefined, { deep: false });
                                selection.observe(change => {
                                    const frame = change.newValue;
                                    postSelectArtifact(result, frame?.location?.physicalLocation);
                                });
                                if (stack.message?.text) {
                                    return <div key={key} className="svStack">
                                        <div className="svStacksMessage">
                                            {stack?.message?.text}
                                        </div>
                                        <div className="svDetailsBody svDetailsCodeflowAndStacks">
                                            <List items={stackFrames} renderItem={renderStack} selection={selection} allowClear />
                                        </div>
                                    </div>;
                                }
                                return undefined;
                            });
                        })()}
                    </div>
                </Tab>
            </TabPanel>}
        </div>;
    }
}
