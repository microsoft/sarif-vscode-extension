// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable indent */ // Allowing for some custom intent under svDetailsGrid 2D layout.

import { action, autorun, computed, IObservableValue, observable } from 'mobx';
import { observer } from 'mobx-react';
import * as React from 'react';
import { Component, Fragment } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { Location, Result, StackFrame, ThreadFlowLocation } from 'sarif';
import { parseArtifactLocation, parseLocation, decodeFileUri } from '../shared';
import './details.scss';
import './index.scss';
import { postRemoveResultFixed, postSelectArtifact, postSelectLog, postSetActiveResult } from './indexStore';
import { Badge, List, Tab, TabPanel, renderMessageTextWithEmbeddedLinks, ResizeHandle, css } from './widgets';
import { StatesTableStore, StateEntry } from './statesTableStore';
import { Table } from './table';

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
    private selectedThreadFlowLocation = observable.box<ThreadFlowLocation | undefined>(undefined, { deep: false })
    private statesTableSelection = observable.box(undefined)
    private statesPaneHeight = observable.box(200) // Default height for states pane
    private contextMenu = observable.box<{ x: number, y: number, variable: string } | null>(null)

    @computed private get threadFlowLocations(): ThreadFlowLocation[] {
		return this.props.result?.codeFlows?.[0]?.threadFlows?.[0].locations ?? [];
	}

    @computed private get statesTableStore(): StatesTableStore {
        const selectedLocation = this.selectedThreadFlowLocation.get();
        const states: StateEntry[] = [];

        if (selectedLocation?.state) {
            Object.entries(selectedLocation.state).forEach(([key, value]) => {
                let processedValue = typeof value === 'object' && value?.text ? value.text : String(value);

                // Replace {expr} with the current key in parentheses
                // For example: if key is 'ptr1' and value is '{expr} == ptr2', result is '(ptr1) == ptr2'
                processedValue = processedValue.replace(/\{expr\}/g, `(${key})`);

                states.push({
                    key,
                    value: processedValue
                });
            });
        }

        return new StatesTableStore({ results: states }, this.statesTableSelection);
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

    componentDidMount() {
        // Set the active result for decorations
        if (this.props.result) {
            postSetActiveResult(this.props.result);
        }

        // Set up MobX observer for text adornments when Analysis Steps selection changes
        this.selectedThreadFlowLocation.observe(change => {
            const threadFlowLocation = change.newValue;
            if (threadFlowLocation) {
                postSelectArtifact(this.props.result, threadFlowLocation.location?.physicalLocation);
            }
        });

        // Close context menu when clicking outside
        document.addEventListener('click', this.handleDocumentClick);
    }

    componentDidUpdate(prevProps: DetailsProps) {
        // Update active result when result prop changes
        if (prevProps.result !== this.props.result && this.props.result) {
            postSetActiveResult(this.props.result);
        }
    }

    componentWillUnmount() {
        // Remove event listener for component being unmounted
        document.removeEventListener('click', this.handleDocumentClick);
    }

    @action private handleDocumentClick = (e: MouseEvent) => {
        // Close context menu if clicking outside
        if (this.contextMenu.get()) {
            this.contextMenu.set(null);
        }
    }

    @action private handleVariableContextMenu = (e: React.MouseEvent, variable: string) => {
        e.preventDefault();
        e.stopPropagation();

        const menuHeight = 4 * 20 + 4; // 4 items * 20px height + 4px padding
        const viewportHeight = window.innerHeight;
        const clickY = e.clientY;

        // Check if menu would be clipped at bottom, if so position it above the click
        let adjustedY;
        if (clickY + menuHeight > viewportHeight) {
            // Position menu above click point so cursor is near top-left of menu
            adjustedY = Math.max(clickY - menuHeight + 10, 10); // +10 to position cursor near top of menu
        } else {
            // Normal positioning below click
            adjustedY = clickY;
        }

        this.contextMenu.set({
            x: e.clientX,
            y: adjustedY,
            variable
        });
    }

    // ===========================================
    // Context Menu Navigation - Core Functions
    // ===========================================

    /**
     * Gets the current step index from the selected thread flow location
     */
    private getCurrentStepIndex = (): number => {
        return this.threadFlowLocations.findIndex(tfl =>
            tfl === this.selectedThreadFlowLocation.get()
        );
    }

    /**
     * Extracts and processes variable value from a thread flow location step
     */
    private getVariableValue = (step: ThreadFlowLocation, variable: string): string | null => {
        if (!step.state) return null;

        const value = step.state[variable];
        if (value === undefined) return null;

        let processedValue = typeof value === 'object' && value?.text ? value.text : String(value);
        // Apply same processing as in statesTableStore
        processedValue = processedValue.replace(/\{expr\}/g, `(${variable})`);

        return processedValue;
    }

    /**
     * Checks if a step has valid state data
     */
    private hasValidState = (step: ThreadFlowLocation): boolean => {
        return !!(step.state && Object.keys(step.state).length > 0);
    }

    // ===========================================
    // Context Menu Navigation - Search Functions
    // ===========================================

    /**
     * Find the first occurrence of a variable in any step
     * Skips steps with no variable states
     */
    private findInitialized = (variable: string): number | null => {
        for (let i = 0; i < this.threadFlowLocations.length; i++) {
            const step = this.threadFlowLocations[i];
            // Skip steps with no variable states
            if (!this.hasValidState(step)) continue;

            const stepValue = this.getVariableValue(step, variable);
            if (stepValue !== null) {
                return i;
            }
        }
        return null;
    }

    /**
     * Find the previous step where the variable had a different value
     * Skips steps with no variable states
     */
    private findPreviouslyChanged = (variable: string): number | null => {
        const currentStepIndex = this.getCurrentStepIndex();
        if (currentStepIndex <= 0) return null;

        const currentStep = this.threadFlowLocations[currentStepIndex];
        const currentValue = this.getVariableValue(currentStep, variable);
        if (currentValue === null) return null;

        // Search backwards from current step
        for (let i = currentStepIndex - 1; i >= 0; i--) {
            const step = this.threadFlowLocations[i];
            // Skip steps with no variable states
            if (!this.hasValidState(step)) continue;

            const stepValue = this.getVariableValue(step, variable);
            // Skip steps where this variable is not present
            if (stepValue === null) continue;

            if (stepValue !== currentValue) {
                return i;
            }
        }
        return null;
    }

    /**
     * Find the next step where the variable will have a different value
     * Skips steps with no variable states
     */
    private findNextChanged = (variable: string): number | null => {
        const currentStepIndex = this.getCurrentStepIndex();
        if (currentStepIndex === -1 || currentStepIndex >= this.threadFlowLocations.length - 1) return null;

        const currentStep = this.threadFlowLocations[currentStepIndex];
        const currentValue = this.getVariableValue(currentStep, variable);
        if (currentValue === null) return null;

        // Search forwards from current step
        for (let i = currentStepIndex + 1; i < this.threadFlowLocations.length; i++) {
            const step = this.threadFlowLocations[i];
            // Skip steps with no variable states
            if (!this.hasValidState(step)) continue;

            const stepValue = this.getVariableValue(step, variable);
            // Skip steps where this variable is not present
            if (stepValue === null) continue;

            if (stepValue !== currentValue) {
                return i;
            }
        }
        return null;
    }

    /**
     * Find the step where the variable was last changed (most recent change)
     * Skips steps with no variable states
     */
    private findLastChanged = (variable: string): number | null => {
        if (this.threadFlowLocations.length === 0) return null;

        const finalStep = this.threadFlowLocations[this.threadFlowLocations.length - 1];
        // Skip if final step has no variable states
        if (!this.hasValidState(finalStep)) return null;

        const finalValue = this.getVariableValue(finalStep, variable);
        if (finalValue === null) return null;

        // Search backwards from the end to find the last change
        for (let i = this.threadFlowLocations.length - 2; i >= 0; i--) {
            const step = this.threadFlowLocations[i];
            // Skip steps with no variable states
            if (!this.hasValidState(step)) continue;

            const stepValue = this.getVariableValue(step, variable);
            // Skip steps where this variable is not present
            if (stepValue === null) continue;

            // If this step has a different value than the final value,
            // then the next step (i+1) is where the last change occurred
            if (stepValue !== finalValue) {
                const targetStepIndex = i + 1;
                // Ensure the target step exists and has valid state
                if (targetStepIndex < this.threadFlowLocations.length &&
                    this.hasValidState(this.threadFlowLocations[targetStepIndex])) {
                    return targetStepIndex;
                }
            }
        }
        return null;
    }

    // ===========================================
    // Context Menu Navigation - Navigation Functions
    // ===========================================

    /**
     * Navigate to a specific step by index and close context menu
     */
    private navigateToStep = (stepIndex: number | null): void => {
        if (stepIndex !== null) {
            this.selectedThreadFlowLocation.set(this.threadFlowLocations[stepIndex]);
        }
        this.contextMenu.set(null);
    }

    private navigateToInitialized = (variable: string): void => {
        const targetIndex = this.findInitialized(variable);
        this.navigateToStep(targetIndex);
    }

    private navigateToPreviouslyChanged = (variable: string): void => {
        const targetIndex = this.findPreviouslyChanged(variable);
        this.navigateToStep(targetIndex);
    }

    private navigateToNextChanged = (variable: string): void => {
        const targetIndex = this.findNextChanged(variable);
        this.navigateToStep(targetIndex);
    }

    private navigateToLastChanged = (variable: string): void => {
        const targetIndex = this.findLastChanged(variable);
        this.navigateToStep(targetIndex);
    }

    // ===========================================
    // Context Menu Navigation - Validation Functions
    // ===========================================

    private canNavigateToInitialized = (variable: string): boolean => {
        return this.findInitialized(variable) !== null;
    }

    private canNavigateToPreviouslyChanged = (variable: string): boolean => {
        return this.findPreviouslyChanged(variable) !== null;
    }

    private canNavigateToNextChanged = (variable: string): boolean => {
        return this.findNextChanged(variable) !== null;
    }

    private canNavigateToLastChanged = (variable: string): boolean => {
        return this.findLastChanged(variable) !== null;
    }

    // ===========================================
    // Context Menu - UI Rendering Functions
    // ===========================================

    /**
     * Context menu item configuration
     */
    private getMenuItemConfig = (variable: string) => {
        return [
            {
                label: 'Initialized',
                canNavigate: this.canNavigateToInitialized(variable),
                navigate: () => this.navigateToInitialized(variable)
            },
            {
                label: 'Previously Changed',
                canNavigate: this.canNavigateToPreviouslyChanged(variable),
                navigate: () => this.navigateToPreviouslyChanged(variable)
            },
            {
                label: 'Next Changed',
                canNavigate: this.canNavigateToNextChanged(variable),
                navigate: () => this.navigateToNextChanged(variable)
            },
            {
                label: 'Last Changed',
                canNavigate: this.canNavigateToLastChanged(variable),
                navigate: () => this.navigateToLastChanged(variable)
            }
        ];
    }

    /**
     * Renders a single context menu item with consistent styling
     */
    private renderContextMenuItem = (item: { label: string, canNavigate: boolean, navigate: () => void }) => {
        return (
            <a
                key={item.label}
                href="#"
                style={{
                    display: 'block',
                    padding: '2px 12px',
                    color: item.canNavigate ? 'var(--vscode-menu-foreground)' : 'var(--vscode-disabledForeground)',
                    textDecoration: 'none',
                    minHeight: '16px',
                    lineHeight: '16px',
                    cursor: item.canNavigate ? 'pointer' : 'default',
                    opacity: item.canNavigate ? 1 : 0.5
                }}
                onMouseEnter={(e) => {
                    if (item.canNavigate) {
                        e.currentTarget.style.backgroundColor = 'var(--vscode-menu-selectionBackground)';
                        e.currentTarget.style.color = 'var(--vscode-menu-selectionForeground)';
                    }
                }}
                onMouseLeave={(e) => {
                    if (item.canNavigate) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--vscode-menu-foreground)';
                    }
                }}
                onClick={(e) => {
                    e.preventDefault();
                    if (item.canNavigate) {
                        item.navigate();
                    }
                }}
            >
                {item.label}
            </a>
        );
    }

    private renderVariableName = (text: string) => {
        // Multiple regex patterns to match different variable naming conventions
        const patterns = [
            // 1. Dot notation with optional backtick: obj.method, obj.method(), obj.prop.method`123, obj.prop.method`123a
            // This pattern should come FIRST to match longer expressions before simple words
            /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+(?:\(\))?(?:`\d+[a-z]?)?)/g,

            // 2. Arrow notation with optional backtick: ptr->member, ptr->member->prop`123, ptr->member->prop`123a
            /([a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)+(?:`\d+[a-z]?)?)/g,

            // 3. Offset expressions with optional backtick: offset(expression), offset(var)`123, offset(var)`123a
            /(offset\([^)]+\)(?:`\d+[a-z]?)?)/g,

            // 4. Curly brace expressions with optional backtick/quote: {loop iteration}, {loop iteration}`123, {loop iteration}'123, {loop iteration}`123a
            /(\{[^}]+\}(?:[`']\d+[a-z]?)?)/g,

            // 5. Simple words with optional backtick - using explicit character boundaries
            // This should come LAST to avoid matching parts of longer expressions
            /(^|[^a-zA-Z0-9_.])([a-zA-Z_][a-zA-Z0-9_]*(?:`\d+[a-z]?)?)($|[^a-zA-Z0-9_.])/g
        ];

        const parts: React.ReactNode[] = [];
        const matches: Array<{ match: string, index: number, length: number }> = [];

        // Collect all matches from all patterns
        patterns.forEach((pattern, patternIndex) => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                let matchText, matchIndex;

                if (patternIndex === 4) {
                    // Last pattern (simple words) has three capture groups: prefix, variable, suffix
                    matchText = match[2]; // The actual variable is in group 2
                    matchIndex = match.index + match[1].length; // Skip the prefix
                } else {
                    // Other patterns use single capture groups
                    matchText = match[1];
                    matchIndex = match.index;
                }

                // Only add valid matches (non-empty variable names)
                if (matchText && matchText.trim()) {
                    matches.push({
                        match: matchText,
                        index: matchIndex,
                        length: matchText.length
                    });
                }
            }
        });

        // Sort matches by position and remove overlaps
        matches.sort((a, b) => a.index - b.index);
        const uniqueMatches: Array<{ match: string, index: number, length: number }> = [];

        for (let i = 0; i < matches.length; i++) {
            const currentMatch = matches[i];
            const lastMatch = uniqueMatches[uniqueMatches.length - 1];

            // Skip if this match overlaps with the previous one
            if (!lastMatch || currentMatch.index >= lastMatch.index + lastMatch.length) {
                uniqueMatches.push(currentMatch);
            }
        }

        // Build the result with React elements
        let lastIndex = 0;
        uniqueMatches.forEach((matchInfo, i) => {
            // Add text before the match
            if (matchInfo.index > lastIndex) {
                const beforeText = text.substring(lastIndex, matchInfo.index);
                parts.push(beforeText);
            }

            // Add the variable name with context menu
            const variable = matchInfo.match;
            parts.push(
                <span
                    key={`${matchInfo.index}-${variable}-${i}`}
                    style={{
                        cursor: 'context-menu',
                        color: 'var(--vscode-symbolIcon-variableForeground)',
                        backgroundColor: 'rgba(255, 255, 0, 0.1)',
                        padding: '1px 2px',
                        borderRadius: '2px',
                        textDecoration: 'underline'
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleVariableContextMenu(e, variable);
                    }}
                >
                    {variable}
                </span>
            );

            lastIndex = matchInfo.index + matchInfo.length;
        });

        // Add remaining text
        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            parts.push(remainingText);
        }

        // If variable names were found, return the React fragment with parts
        return uniqueMatches.length > 0 ? <>{parts}</> : text;
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
                        <div
                            className="svDetailsMessage"
                            ref={(element) => {
                                if (element && result._message) {
                                    // Check for truncation after layout
                                    setTimeout(() => {
                                        if (element.scrollWidth > element.clientWidth) {
                                            element.setAttribute('title', result._message);
                                        } else {
                                            element.removeAttribute('title');
                                        }
                                    }, 0);
                                }
                            }}
                        >
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
                                                                    return <a
                                                                        key={i}
                                                                        href="#"
                                                                        className="ellipsis"
                                                                        ref={(element) => {
                                                                            if (element && uri) {
                                                                                // Check for truncation after layout
                                                                                setTimeout(() => {
                                                                                    if (element.scrollWidth > element.clientWidth) {
                                                                                        element.setAttribute('title', uri);
                                                                                    } else {
                                                                                        element.removeAttribute('title');
                                                                                    }
                                                                                }, 0);
                                                                            }
                                                                        }}
                                                                        onClick={e => {
                                                                            e.preventDefault(); // Cancel # nav.
                                                                            postSelectArtifact(result, ploc);
                                                                        }}>
                                                                        {uri?.file ?? '-'}
                                                                    </a>;
                                                                }) ?? <span>—</span>}
                                                            </span>
                            <span>Log</span>				<a
                                                                href="#"
                                                                ref={(element) => {
                                                                    if (element) {
                                                                        const uri = decodeFileUri(result._log._uri);
                                                                        // Check for truncation after layout
                                                                        setTimeout(() => {
                                                                            if (element.scrollWidth > element.clientWidth) {
                                                                                element.setAttribute('title', uri);
                                                                            } else {
                                                                                element.removeAttribute('title');
                                                                            }
                                                                        }, 0);
                                                                    }
                                                                }}
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
                                            <span
                                                className="ellipsis"
                                                ref={(element) => {
                                                    if (element && key) {
                                                        // Check for truncation after layout
                                                        setTimeout(() => {
                                                            if (element.scrollWidth > element.clientWidth) {
                                                                element.setAttribute('title', key);
                                                            } else {
                                                                element.removeAttribute('title');
                                                            }
                                                        }, 0);
                                                    }
                                                }}
                                            >{key}</span>
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
                    <div
                        className="svDetailsBody"
                        style={{
                            height: '100%',
                            overflow: 'hidden',
                            position: 'relative'
                        }}
                    >
                        {/* Analysis Steps List */}
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: `${this.statesPaneHeight.get() + 1}px`,
                            minHeight: '200px',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column'
                        }}>
                            {(() => {
                                // Calculate the maximum width needed for filename:line:column text
                                const calculateMaxLocationWidth = () => {
                                    let maxWidth = 0;
                                    this.threadFlowLocations.forEach(threadFlowLocation => {
                                        const { uri, region } = parseLocation(result, threadFlowLocation.location);
                                        const filename = uri?.file ?? '—';
                                        const location = `${region?.startLine}:${region?.startColumn ?? 1}`;
                                        const locationText = `${filename} ${location}`;
                                        // Very precise estimate: 5.5 pixels per character for 12px font + minimal 6px gap
                                        const estimatedWidth = locationText.length * 5.5 + 6;
                                        maxWidth = Math.max(maxWidth, estimatedWidth);
                                    });
                                    // Minimal padding, tighter bounds: 80px min, 200px max
                                    return Math.min(Math.max(maxWidth + 6, 80), 200);
                                };

                                const locationColumnWidth = calculateMaxLocationWidth();

                                const renderThreadFlowLocation = (threadFlowLocation: ThreadFlowLocation) => {
                                    const marginLeft = ((threadFlowLocation.nestingLevel ?? 1) - 1) * 16;
                                    const { message, uri, region } = parseLocation(result, threadFlowLocation.location);
                                    const filename = uri?.file ?? '—';
                                    const location = `${region?.startLine}:${region?.startColumn ?? 1}`;
                                    const description = message ?? '—';

                                    return <>
                                        <div
                                            style={{
                                                marginLeft,
                                                display: 'grid',
                                                gridTemplateColumns: `1fr ${locationColumnWidth}px`,
                                                alignItems: 'center',
                                                gap: '8px',
                                                minWidth: 0,
                                                height: '20px',
                                                fontSize: '12px'
                                            }}
                                        >
                                            <div
                                                className="ellipsis"
                                                style={{
                                                    minWidth: 0
                                                }}
                                                ref={(element) => {
                                                    if (element && description) {
                                                        setTimeout(() => {
                                                            if (element.scrollWidth > element.clientWidth) {
                                                                element.setAttribute('title', description);
                                                            } else {
                                                                element.removeAttribute('title');
                                                            }
                                                        }, 0);
                                                    }
                                                }}
                                            >
                                                {description}
                                            </div>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                justifyContent: 'flex-start'
                                            }}>
                                                <span className="svSecondary">
                                                    {filename}
                                                </span>
                                                <span className="svLineNum">
                                                    {location}
                                                </span>
                                            </div>
                                        </div>
                                    </>;
                                };

                                if (this.threadFlowLocations.length === 0) {
                                    return <div className="svList svListZero">
                                        <span className="svSecondary">No analysis steps in selected result.</span>
                                    </div>;
                                }

                                return <div style={{ height: '100%' }}>
                                    <List
                                        items={this.threadFlowLocations}
                                        renderItem={renderThreadFlowLocation}
                                        selection={this.selectedThreadFlowLocation}
                                        allowClear={true}
                                    />
                                </div>;
                            })()}
                        </div>

                        {/* Resizer between Analysis Steps and States */}
                        <div style={{
                            position: 'absolute',
                            bottom: `${this.statesPaneHeight.get()}px`,
                            left: 0,
                            right: 0,
                            height: '1px',
                            backgroundColor: 'var(--vscode-editorGroup-border)',
                            cursor: 'row-resize',
                            userSelect: 'none',
                            zIndex: 10
                        }}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();

                            const startY = e.clientY;
                            const startHeight = this.statesPaneHeight.get();

                            const onMouseMove = action((moveEvent: MouseEvent) => {
                                moveEvent.preventDefault();
                                const delta = startY - moveEvent.clientY;
                                const newHeight = Math.max(150, Math.min(800, startHeight + delta));
                                this.statesPaneHeight.set(newHeight);
                            });

                            const onMouseUp = (upEvent: MouseEvent) => {
                                upEvent.preventDefault();
                                document.removeEventListener('mousemove', onMouseMove);
                                document.removeEventListener('mouseup', onMouseUp);
                                document.body.style.cursor = '';
                                document.body.style.userSelect = '';
                            };

                            document.body.style.cursor = 'row-resize';
                            document.body.style.userSelect = 'none';
                            document.addEventListener('mousemove', onMouseMove);
                            document.addEventListener('mouseup', onMouseUp);
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--vscode-focusBorder)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--vscode-editorGroup-border)';
                        }}>
                        </div>

                        {/* States Table Pane */}
                        <div
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: `${this.statesPaneHeight.get()}px`,
                                minHeight: '150px',
                                maxHeight: '800px',
                                display: 'flex',
                                flexDirection: 'column',
                                borderTop: '1px solid var(--vscode-panel-border)',
                                overflow: 'hidden',
                                backgroundColor: 'var(--vscode-editor-background)'
                            }}>
                            <div style={{
                                display: 'flex',
                                padding: '0 12px',
                                userSelect: 'none',
                                borderBottom: '1px solid var(--vscode-panel-border)',
                                flex: '0 0 auto',
                                height: '24px',
                                alignItems: 'center',
                                backgroundColor: 'var(--vscode-editor-background)'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    border: '1px solid var(--vscode-panel-border)',
                                    textTransform: 'uppercase',
                                    fontSize: '10px',
                                    lineHeight: '16px',
                                    color: 'var(--vscode-panelTitle-activeForeground)',
                                    fontWeight: 'bold',
                                    padding: '1px 6px 1px 6px',
                                    backgroundColor: 'var(--vscode-list-activeSelectionBackground)',
                                    cursor: 'pointer'
                                }}>
                                    <span>STATES</span>&nbsp;&nbsp;
                                    <Badge text={this.statesTableStore.rowItems.length} />
                                </div>
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                                {this.statesTableStore.rowItems.length > 0 ? (
                                    <Table
                                        columns={this.statesTableStore.columns}
                                        store={this.statesTableStore}
                                        renderCell={(col, item) => {
                                            const text = col.toString(item);
                                            return (
                                                <span
                                                    ref={(element) => {
                                                        if (element) {
                                                            // Check for truncation after layout
                                                            setTimeout(() => {
                                                                if (element.scrollWidth > element.clientWidth) {
                                                                    element.setAttribute('title', text);
                                                                } else {
                                                                    element.removeAttribute('title');
                                                                }
                                                            }, 0);
                                                        }
                                                    }}
                                                >
                                                    {(col.name === 'Key' || col.name === 'Value') ? this.renderVariableName(text) : text}
                                                </span>
                                            );
                                        }}
                                    >
                                        <div className="svZeroData">
                                            <span>No state data available.</span>
                                        </div>
                                    </Table>
                                ) : (
                                    <div className="svZeroData" style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        height: '100%',
                                        textAlign: 'center'
                                    }}>
                                        <span className="svSecondary">
                                            {this.selectedThreadFlowLocation.get()
                                                ? 'No states available for selected analysis step.'
                                                : 'Select an analysis step to view its states.'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
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
                                    <div
                                        className="ellipsis"
                                        ref={(element) => {
                                            if (element && text) {
                                                // Check for truncation after layout
                                                setTimeout(() => {
                                                    if (element.scrollWidth > element.clientWidth) {
                                                        element.setAttribute('title', text ?? '—');
                                                    } else {
                                                        element.removeAttribute('title');
                                                    }
                                                }, 0);
                                            }
                                        }}
                                    >{text ?? '—'}</div>
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
                                        <div
                                            className="svStacksMessage"
                                            ref={(element) => {
                                                if (element && stack?.message?.text) {
                                                    const messageText = stack.message.text;
                                                    // Check for truncation after layout
                                                    setTimeout(() => {
                                                        if (element.scrollWidth > element.clientWidth) {
                                                            element.setAttribute('title', messageText);
                                                        } else {
                                                            element.removeAttribute('title');
                                                        }
                                                    }, 0);
                                                }
                                            }}
                                        >
                                            {stack?.message?.text}
                                        </div>
                                        <div className="svDetailsBody svDetailsCodeflowAndStacks">
                                            <List items={stackFrames} renderItem={renderStack} selection={selection} allowClear />
                                        </div>
                                    </div>;
                                }
                                return null; // Return null for stacks without message text
                            });
                        })()}
                    </div>
                </Tab>
            </TabPanel>}

            {/* Context Menu - Render using Portal */}
            {this.contextMenu.get() && createPortal(
                <div
                    style={{
                        position: 'fixed',
                        left: `${this.contextMenu.get()!.x}px`,
                        top: `${this.contextMenu.get()!.y}px`,
                        backgroundColor: 'var(--vscode-menu-background)',
                        border: '1px solid var(--vscode-menu-border)',
                        borderRadius: '3px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                        zIndex: 9999,
                        minWidth: '120px',
                        fontSize: '12px',
                        padding: '2px 0'
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseLeave={() => {
                        this.contextMenu.set(null);
                    }}
                >
                    {(() => {
                        const variable = this.contextMenu.get()!.variable;
                        const menuItems = this.getMenuItemConfig(variable);

                        return menuItems.map(item => this.renderContextMenuItem(item));
                    })()}
                </div>,
                document.body
            )}
        </div>;
    }
}
