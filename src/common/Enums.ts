// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/

/** Updating this also requires an update to the matching enum in the explorer folder */
export enum MessageType {
    AttachmentSelectionChange,
    CodeFlowSelectionChange,
    ExplorerLoaded,
    NewDiagnostic,
    ResultsListDataSet,
    ResultsListColumnToggled,
    ResultsListGroupChanged,
    ResultsListResultSelected,
    ResultsListSortChanged,
    SourceLinkClicked,
    TabChanged,
    VerbosityChanged,
}

export const enum SeverityLevelOrder {
    error = 0,
    warning = 1,
    open = 2,
    pass = 3,
    notApplicable = 4,
    note = 5,
}
