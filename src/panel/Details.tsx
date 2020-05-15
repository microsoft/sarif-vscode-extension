// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { autorun, computed, IObservableValue, observable } from 'mobx'
import { observer } from 'mobx-react'
import * as React from 'react'
import { Component } from 'react'
import ReactMarkdown from 'react-markdown'
import { Result, ThreadFlowLocation } from 'sarif'
import { parseArtifactLocation, parseLocation } from '../shared'
import './Details.scss'
import { postSelectArtifact, postSelectLog } from './IndexStore'
import { List, renderMessageWithEmbeddedLinks, TabPanel } from './widgets'

@observer export class Details extends Component<{ result: Result, height: IObservableValue<number> }> {
	private selectedTab = observable.box('Info')
	@computed private get threadFlowLocations() {
		return this.props.result?.codeFlows?.[0]?.threadFlows?.[0].locations
			.filter(tfLocation => tfLocation.location)
	}
	constructor(props) {
		super(props)
		autorun(() => {
			const hasThreadFlows = !!this.threadFlowLocations?.length
			this.selectedTab.set(hasThreadFlows ? 'Code Flows' : 'Info')
		})
	}
	render() {
		const renderRuleDesc = (desc?: { text: string, markdown?: string }) => {
			if (!desc) return '—'
			return desc.markdown
				? <ReactMarkdown className="svMarkDown" source={desc.markdown} />
				: desc.text
		}

		const {result, height} = this.props
		const helpUri = result?._rule?.helpUri
		return <div className="svDetailsPane" style={{ height: height.get() }}>
			{result && <TabPanel tabs={['Info', 'Code Flows']} selection={this.selectedTab}>
				<div className="svDetailsBody svDetailsInfo">
					<div className="svDetailsMessage">
						{result._markdown
							? <ReactMarkdown className="svMarkDown" source={result._markdown} escapeHtml={false} />
							: renderMessageWithEmbeddedLinks(result, vscode.postMessage)}</div>
					<div className="svDetailsGrid">
						<span>Rule Id</span>			{helpUri ? <a href={helpUri} target="_blank">{result.ruleId}</a> : <span>{result.ruleId}</span>}
						<span>Rule Name</span>			<span>{result._rule?.name ?? '—'}</span>
						<span>Rule Desc Short</span>	<span>{renderRuleDesc(result._rule?.shortDescription)}</span>
						<span>Rule Desc Full</span>		<span>{renderRuleDesc(result._rule?.fullDescription)}</span>
						<span>Level</span>				<span>{result.level}</span>
						<span>Kind</span>				<span>{result.kind ?? '—'}</span>
						<span>Baseline State</span>		<span>{result.baselineState}</span>
						<span>Locations</span>			<span>
															{result.locations?.map((loc, i) => {
																const ploc = loc.physicalLocation
																const [uri, _] = parseArtifactLocation(result, ploc?.artifactLocation)
																return <a key={i} href="#" className="ellipsis" title={uri}
																	onClick={e => {
																		e.preventDefault() // Cancel # nav.
																		postSelectArtifact(result, ploc)
																	}}>
																	{uri?.file ?? '-'}
																</a>
															}) ?? <span>—</span>}
														</span>
						<span>Log</span>				<a href="#" title={result._log._uri}
															onClick={e => {
																e.preventDefault() // Cancel # nav.
																postSelectLog(result)
															}}>
															{result._log._uri.file}{result._log._uriUpgraded && ' (upgraded)'}
														</a>
						{/* <span>Properties</span>		<span><pre><code>{JSON.stringify(selected.properties, null, '  ')}</code></pre></span> */}
					</div>
				</div>
				<div className="svDetailsBody svDetailsCodeflow">
					{(() => {
						const items = this.threadFlowLocations

						const selection = observable.box(undefined as ThreadFlowLocation, { deep: false })
						selection.observe(change => {
							const tfloc = change.newValue
							postSelectArtifact(result, tfloc?.location?.physicalLocation)
						})

						const renderItem = (tfLocation: ThreadFlowLocation) => {
							const { message, uri, region } = parseLocation(result, tfLocation.location)
							return <>
								<div className="ellipsis">{message ?? '—'}</div>
								<div className="svSecondary">{uri?.file ?? '—'}</div>
								<div className="svLineNum">{region.startLine}:1</div>
							</>
						}

						return <List items={items} renderItem={renderItem} selection={selection} allowClear>
							<span className="svSecondary">No code flows in selected result.</span>
						</List>
					})()}
				</div>
			</TabPanel>}
		</div>
	}
}
