// Enums

/** Updating this also requires an update to the matching enum in the explorer folder */
enum MessageType {
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

enum tabNames {
    "attachments" = "attachmentstab",
    "codeflow" = "codeflowtab",
    "resultinfo" = "resultinfotab",
    "runinfo" = "runinfotab",
}

enum ToggleState {
    "collapsed" = "collapsed",
    "expanded" = "expanded",
}

enum TreeClassNames {
    ExpandState,
    Importance,
    VerbosityShowState,
}
