// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import { Location } from "./Location";

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

export interface CodeFlow {
    message: string;
    threads: ThreadFlow[];
}

export interface ThreadFlow {
    message: string;
    id: string;
    steps: CodeFlowStep[];
}

export interface CodeFlowStep {
    importance: sarif.CodeFlowLocation.importance,
    isLastChild: boolean;
    isParent: boolean;
    location: Location;
    message: string;
    state: object;
    stepId: number;
    traversalId: string;
}

export interface Message {
    text: string,
    html: HTMLLabelElement
}

export interface Attachment {
    description: Message,
    file: Location,
    regionsOfInterest: Location[]
}

export interface TreeNodeOptions {
    isParent: boolean,
    liClass: string,
    locationText: string,
    message: string,
    requestId: string,
    tooltip: string,
}
