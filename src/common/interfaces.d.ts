// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Command, Position, Range, Uri, Event } from "vscode";
import { MessageType, SeverityLevelOrder, KindOrder, BaselineOrder } from "./enums";

/**
* Interface for options to set while creating an html element
*/
export interface HTMLElementOptions {
    /**
    *  The id to set on the element
    */
    id?: string;

    /**
    *  The text to set on the element
    */
    text?: string;

    /**
     *  The class name to set on the element
     */
    className?: string;

    /**
     * The tooltip to set on the element
     */
    tooltip?: string;

    /**
     * object filled with any attributes to set on the element
     */
    attributes?: {
        readonly [key: string]: any;
    }
}

/**
 * Options used when attempting file mapping.
 */
export interface MapLocationToLocalPathOptions {
    /**
     * Specifies whether to prompt the user for a path, or to attempt to map silently.
     */
    promptUser: boolean;
}

export interface Location {
    /**
     * Contains the location of this "location" inside the SARIF JSON file.
     */
    locationInSarifFile?: sarif.Location;

    id?: number;
    endOfLine?: boolean;
    fileName?: string;
    logicalLocations?: string[];

    /**
     * Indicates if this location has been mapped to a local path.
     */
    mappedToLocalPath: boolean;

    message?: Message;
    range: Range;
    uri?: Uri;
    uriBase?: string;

    /**
     * Maps a location to a local path.
     */
    mapLocationToLocalPath(this: Location, options: MapLocationToLocalPathOptions): Promise<Uri | undefined>;

    /**
     * Serializes "start" and "stop" properties of VSCode's range as part of the location.
     * That way we can properly type the web view code.
     * @param this Represents the location being serialized.
     * @param key The "key" in the outer object that represents the location: (i.e. "locationInSarifFile: Location"  - the key is "locationInSarifFile")
     * @param value The current location value.
     */
    toJSON(this: Location, key: any, value: any): any

    /**
     * Event that is fired when the location is mapped..
     */
    locationMapped: Event<Location>;
}


export interface RunInfo {
    /**
     * The index of the run in the SARIF log.
     */
    readonly runIndex: number;
    readonly additionalProperties?: { [key: string]: string };
    readonly automationCategory?: string;
    readonly automationIdentifier?: string;
    readonly cmdLine?: string;

    /**
     * Uniquely identifies this run ID.
     * The number is assigned by the "Result Info Factory", so these
     * IDs simply grow by one every time a SARIF run is parsed.
     */
    readonly id: number;

    readonly sarifFileFullPath: string;
    readonly sarifFileName: string;
    readonly startUtc?: string;
    readonly timeDuration?: string;
    readonly toolFileName?: string;
    readonly toolFullName?: string;
    readonly toolName: string;

    /**
     * Provides a map between a "baseID" (such as %srcroot%) to its absolute URI.
     * For example a run can contain "originalUriBaseIds" contains an ID of
     * %srcRoot% which had a value of "/src" and a uriBaseId of %driveRoot%
     * "originalUriBaseIds": {
     *    "SRCROOT": {
     *      "uri": "/src",
     *      "uriBaseId": "DRIVEROOT"
     *    },
     *    "DRIVEROOT": {
     *      "uri" : "file:///E:"
     *    },
     * }
     * then this map would contain [ "SRCROOT" : "file:///E:/SRC" , "DRIVEROOT" => "file://E:" ]
     */
    readonly expandedBaseIds?: { [uriBaseId: string]: string };

    readonly workingDir?: string;
}

export interface ResultInfo {
    runInfo: RunInfo;
    additionalProperties?: { [key: string]: string };
    assignedLocation?: Location;
    attachments: Attachment[];
    baselineState: sarif.Result.baselineState;
    codeFlows: CodeFlow[];
    fixes: Fix[];
    id: number;
    kind: sarif.Result.kind;
    resultLocationInSarifFile: Location;
    locations: Location[];
    message: Message;
    messageHTML?: HTMLLabelElement;
    rank?: number;
    relatedLocs: Location[];
    ruleHelpUri?: string;
    ruleId?: string;
    ruleName?: string;
    ruleDescription?: Message;
    runId: number;
    severityLevel: sarif.Result.level;
    stacks: Stacks;
    rawResult: sarif.Result;
}

export interface CodeFlow {
    message?: string;
    threads: ThreadFlow[];
}

export interface ThreadFlow {
    message?: string;
    lvlsFirstStepIsNested: number;
    id?: string;
    steps: CodeFlowStep[];
}

export interface CodeFlowStepId {
    cFId: number,
    tFId: number,
    stepId: number
}

export interface CodeFlowStep {
    beforeIcon?: string;
    codeLensCommand: Command;
    importance: sarif.ThreadFlowLocation.importance,
    isLastChild: boolean;
    isParent: boolean;
    location?: Location;
    message: string;
    messageWithStep: string;
    nestingLevel: number;
    state?: object;
    stepId?: number;
    traversalId: string;
}

export type StackHeaderType = 'result' | 'message' | 'name' | 'location' | 'filename' | 'parameters' | 'threadId';
export type StackColumnWithContent  = { [key in StackHeaderType] : boolean };

export interface Stacks {
    columnsWithContent: StackColumnWithContent,
    stacks: Stack[];
}

export interface Stack {
    frames: Frame[];
    message: Message;
}

export interface Frame {
    location: Location;
    message: Message;
    name: string;
    parameters: string[];
    threadId?: number;
}

export interface Message {
    html?: string,
    text?: string,
}

export interface Attachment {
    description: Message,
    location: Location,
    regionsOfInterest: Location[]
}

export interface Fix {
    description: Message,
    files: FixFile[]
}

export interface FixFile {
    location: Location,
    changes: FixChange[]
}

export interface FixChange {
    delete: Range,
    insert?: string

    /**
     * Serializes "start" and "stop" properties of VSCode's range as part of the location.
     * That way we can properly type the web view code.
     * @param this Represents the FixChange being serialized.
     * @param key The "key" in the outer object that respresents the location: (i.e. "changes: FixChange[]"  - the key is "changes")
     * @param value The current location value.
     */
    toJSON(this: FixChange, key: any, value: any): any
}

export interface TreeNodeOptions {
    isParent: boolean,
    liClass?: string,
    location?: Location,
    locationLine?: string,
    locationText?: string,
    logicalLocation?: string,
    message?: string,
    requestId: string,
    tooltip?: string,
}

export interface WebviewMessage {
    type: MessageType,
    data: string
}

export interface DiagnosticData {
    activeTab?: any,
    resultInfo: ResultInfo,
    runInfo: RunInfo,
    selectedRow?: string,
    selectedVerbosity?: any
}

export interface LocationData {
    eCol: string,
    eLine: string,
    file: string,
    sCol: string,
    sLine: string,
}

export interface ResultsListData {
    columns: { [key: string]: ResultsListColumn },
    filterCaseMatch: boolean,
    filterText: string,
    groupBy?: string,
    groups: ResultsListGroup[],
    resultCount: number,
    sortBy?: ResultsListSortBy,
}

export interface ResultsListGroup {
    rows: ResultsListRow[],
    text: string,
    tooltip?: string,
}

export interface ResultsListRow {
    automationCat: ResultsListStringValue,
    automationId: ResultsListStringValue,
    baselineState: ResultsListBaselineValue,
    kind: ResultsListKindValue,
    logicalLocation: ResultsListStringValue,
    message: ResultsListStringValue,
    rank: ResultsListNumberValue,
    resultFile: ResultsListStringValue,
    resultId: ResultsListNumberValue,
    resultStartPos: ResultsListPositionValue,
    ruleId: ResultsListStringValue,
    ruleName: ResultsListStringValue,
    runId: ResultsListNumberValue,
    sarifFile: ResultsListStringValue,
    severityLevel: ResultsListSeverityValue,
    tool: ResultsListStringValue,
    readonly [key: string]: ResultsListStringValue | ResultsListNumberValue | ResultsListCustomOrderValue | ResultsListPositionValue | undefined;
}

export type ResultsListValueKind = 'Base' | 'String' | 'Number' | 'Position' | 'Custom Order';
export interface ResultsListValue {
    kind: ResultsListValueKind,
    value?: any,
    tooltip?: string,
}

export interface ResultsListStringValue extends ResultsListValue {
    kind: 'String',
}

export interface ResultsListNumberValue extends ResultsListValue {
    kind: 'Number',
}

export interface ResultsListPositionValue extends ResultsListValue {
    kind: 'Position',
    pos?: Position,
}

export interface ResultsListCustomOrderValue extends ResultsListValue {
    kind: 'Custom Order',
    customOrderType : 'Baseline' | 'Kind' | 'Severity';
    order: BaselineOrder | KindOrder | SeverityLevelOrder,
    value?: sarif.Result.baselineState | sarif.Result.kind | sarif.Result.level,
}

export interface ResultsListBaselineValue extends ResultsListCustomOrderValue {
    customOrderType: 'Baseline',
    order: BaselineOrder
    value: sarif.Result.baselineState;
}

export interface ResultsListKindValue extends ResultsListCustomOrderValue {
    customOrderType: 'Kind',
    order: KindOrder
    value: sarif.Result.kind;
}

export interface ResultsListSeverityValue extends ResultsListCustomOrderValue {
    customOrderType: 'Severity',
    order: SeverityLevelOrder
    value: sarif.Result.level,
}

export interface ResultsListColumn {
    description: string,
    hide: boolean,
    title: string
}

export interface ResultsListSortBy {
    column: string,
    ascending: boolean
}

export interface SarifVersion {
    original: string,
    csd?: number,
    csdDate?: Date,
    rtm?: number,
    major: number,
    minor: number,
    sub: number,
}

export interface JsonPointer {
    value: {
        line: number;
        column: number;
    };
    valueEnd: {
        line: number;
        column: number;
    };
}

export interface JsonMapping {
    data: sarif.Log,
    pointers: {
        [jsonPath: string] : JsonPointer
    },
}


export interface JsonMap {
    parse: (json: string) => JsonMapping;
}