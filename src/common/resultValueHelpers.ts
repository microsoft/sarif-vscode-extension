/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import { ResultsListValue, ResultsListPositionValue, ResultsListCustomOrderValue, ResultsListStringValue, ResultsListNumberValue } from "./interfaces";

export function isResultsListPositionValue(value: ResultsListValue): value is ResultsListPositionValue {
    return value.kind === 'Position';
}

export function isResultsListCustomOrderValue(value: ResultsListValue): value is ResultsListCustomOrderValue {
    return value.kind === 'Custom Order';
}

export function isResultsListStringValue(value: ResultsListValue): value is ResultsListStringValue {
    return value.kind === 'String';
}

export function isResultsListNumberValue(value: ResultsListValue): value is ResultsListNumberValue {
    return value.kind === 'Number';
}
