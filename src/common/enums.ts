/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

// tslint:disable-next-line: no-single-line-block-comment
/** Updating this also requires an update to the matching enum in the explorer folder */
export enum MessageType {
    AttachmentSelectionChange,
    CodeFlowSelectionChange,
    ExplorerLoaded,
    NewDiagnostic,
    ResultsListColumnToggled,
    ResultsListDataSet,
    ResultsListFilterApplied,
    ResultsListFilterCaseToggled,
    ResultsListGroupChanged,
    ResultsListResultSelected,
    ResultsListSortChanged,
    SourceLinkClicked,
    TabChanged,
    VerbosityChanged,
}

export const enum SeverityLevelOrder {
    error,
    warning,
    note,
    none,
}

export const enum KindOrder {
    notApplicable,
    pass,
    fail,
    review,
    open,
}

export const enum BaselineOrder {
    new,
    updated,
    unchanged,
    absent,
}
