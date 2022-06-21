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
import { postSelectArtifact, postSelectLog } from './indexStore';
import { List, Tab, TabPanel, renderMessageTextWithEmbeddedLinks } from './widgets';

type TabName = 'Info' | 'Analysis Steps';

interface DetailsProps { result: Result, height: IObservableValue<number> }
@observer export class Details extends Component<DetailsProps> {
    private selectedTab = observable.box<TabName>('Info')
    @computed private get threadFlowLocations(): ThreadFlowLocation[] {
		return this.props.result?.codeFlows?.[0]?.threadFlows?.[0].locations ?? [];
	}
    @computed private get stacks() {
        return this.props.result?.stacks;
    }
    constructor(props: DetailsProps) {
        super(props);
        autorun(() => {
            const hasThreadFlows = !!this.threadFlowLocations.length;
            this.selectedTab.set(hasThreadFlows ? 'Analysis Steps' : 'Info');
        });
    }
    render() {
        const renderRuleDesc = (result: Result) => {
            const desc = result?._rule?.fullDescription ?? result?._rule?.shortDescription;
            if (!desc) return '—';
            return desc.markdown
                ? <ReactMarkdown className="svMarkDown" source={desc.markdown} escapeHtml={false} />
                : renderMessageTextWithEmbeddedLinks(desc.text, result, vscode.postMessage);
        };

        const {result, height} = this.props;
        const helpUri = result?._rule?.helpUri;

        return <div className="svDetailsPane" style={{ height: height.get() }}>
            {result && <TabPanel selection={this.selectedTab}>
                <Tab name="Info">
                    <div className="svDetailsBody svDetailsInfo">
                        <div className="svDetailsMessage">
                            {result._markdown
                                ? <ReactMarkdown className="svMarkDown" source={result._markdown} escapeHtml={false} />
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
                                                                    const [uri, _] = parseArtifactLocation(result, ploc?.artifactLocation);
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
                            {(() => {
                                // Rendering "tags" reserved for a future release.
                                const { tags, ...rest } = result.properties ?? {};
                                return <>
                                    <span>&nbsp;</span><span></span>{/* Blank separator line */}
                                    {Object.entries(rest).map(([key, value]) => {
                                        return <Fragment key={key}>
                                            <span className="ellipsis">{key}</span>
                                            <span>{(() => {
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
                    <div className="svDetailsBody svDetailsCodeflowAndStacks">
                        {(() => {
                            const renderThreadFlowLocation = (threadFlowLocation: ThreadFlowLocation) => {
                                const marginLeft = ((threadFlowLocation.nestingLevel ?? 1) - 1) * 24;
                                const { message, uri, region } = parseLocation(result, threadFlowLocation.location);
                                return <>
                                    <div className="ellipsis" style={{ marginLeft }}>{message ?? '—'}</div>
                                    <div className="svSecondary">{uri?.file ?? '—'}</div>
                                    <div className="svLineNum">{region?.startLine}:{region?.startColumn ?? 1}</div>
                                </>;
                            };

                            const selection = observable.box<ThreadFlowLocation | undefined>(undefined, { deep: false });
                            selection.observe(change => {
                                const threadFlowLocation = change.newValue;
                                postSelectArtifact(result, threadFlowLocation?.location?.physicalLocation);
                            });

                            return <List items={this.threadFlowLocations} renderItem={renderThreadFlowLocation} selection={selection} allowClear>
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

                            return this.stacks.map(stack => {
                                const stackFrames = stack.frames;

                                const selection = observable.box<Location | undefined>(undefined, { deep: false });
                                selection.observe(change => {
                                    const location = change.newValue;
                                    postSelectArtifact(result, location?.physicalLocation);
                                });
                                if (stack.message?.text) {
                                    return <div className="svStack">
                                        <div className="svStacksMessage">
                                            {stack?.message?.text}
                                        </div>
                                        <div className="svDetailsBody svDetailsCodeflowAndStacks">
                                            <List items={stackFrames} renderItem={renderStack} selection={selection} allowClear />
                                        </div>
                                    </div>;
                                }
                            });
                        })()}
                    </div>
                </Tab>
            </TabPanel>}
        </div>;
    }
}
