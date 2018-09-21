// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { Command, Diagnostic, DiagnosticCollection, Position, Range, Uri } from "vscode";
import { sarif } from "./SARIFInterfaces";
import { MessageType } from "./Enums";

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
    attributes?: object;
}

export interface Location {
    id: number;
    endOfLine: boolean;
    fileName: string;
    mapped: boolean;
    message: Message;
    range: Range;
    uri: Uri;
    uriBase: string;
}

export interface SarifViewerDiagnostic extends Diagnostic {
    resultInfo: ResultInfo;
    rawResult: sarif.Result;
}

export interface RunInfo {
    additionalProperties: { [key: string]: string };
    cmdLine: string;
    id: number;
    sarifFileName: string;
    toolFileName: string;
    toolFullName: string;
    toolName: string;
    uriBaseIds: { [key: string]: string };
    workingDir: string;
}

export interface ResultInfo {
    additionalProperties: { [key: string]: string };
    assignedLocation: Location;
    attachments: Attachment[];
    codeFlows: CodeFlow[];
    locations: Location[];
    message: Message;
    messageHTML: HTMLLabelElement;
    relatedLocs: Location[];
    ruleHelpUri: string;
    ruleId: string;
    ruleName: string;
    ruleDescription: Message;
    runId: number;
    severityLevel: sarif.Result.level;
}

export interface CodeFlow {
    message: string;
    threads: ThreadFlow[];
}

export interface ThreadFlow {
    message: string;
    lvlsFirstStepIsNested: number;
    id: string;
    steps: CodeFlowStep[];
}

export interface CodeFlowStepId {
    cFId: number,
    tFId: number,
    stepId: number
}

export interface CodeFlowStep {
    beforeIcon: string;
    codeLensCommand: Command;
    importance: sarif.ThreadFlowLocation.importance,
    isLastChild: boolean;
    isParent: boolean;
    location: Location;
    message: string;
    messageWithStep: string;
    nestingLevel: number;
    state: object;
    stepId: number;
    traversalId: string;
}

export interface Message {
    html: { text: string, locations: { text: string, loc: Location }[] },
    text: string,
}

export interface Attachment {
    description: Message,
    file: Location,
    regionsOfInterest: Location[]
}

export interface TreeNodeOptions {
    isParent: boolean,
    liClass: string,
    locationLine: string,
    locationText: string,
    message: string,
    requestId: string,
    tooltip: string,
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

export interface ResultListData {
    columns: string[],
    groups: ResultListGroup[],
}

export interface ResultListGroup {
    rows: ResultListRow[],
}

export interface ResultListRow {
    message: Message,
    resultFile: string,
    resultStartPos: Position,
    ruleId: string,
    ruleName: string,
    runId: string,
    sarifFile: string,
    severityLevel: sarif.Result.level,
}
