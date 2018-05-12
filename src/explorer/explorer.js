// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/

var TreeClassNames = {
    ExpandState: 0,
    Importance: 1,
    VerbosityShowState: 2,
};

/**
 * Method to add tooltips to the content, currently just puts the text content into the tooltip
 */
function addTooltips() {
    const elements = document.getElementsByClassName("td-contentvalue");
    for (let i = 0; i < elements.length; i++) {
        elements[i].setAttribute("title", elements[i].textContent);
    }
}

/**
 * Hookups all of the event listeners
 */
function hookupEventListeners() {
    const tabs = document.getElementById("tabcontainer").children;
    for (let i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener("click", onTabClicked);
    }

    const sourceLinks = document.getElementsByClassName("sourcelink");
    for (let i = 0; i < sourceLinks.length; i++) {
        sourceLinks[i].addEventListener("click", onSourceLinkClicked);
    }

    if (document.getElementById("codeflowtabcontent") !== null) {
        const codeflowtrees = document.getElementsByClassName("codeflowtreeroot");
        for (let i = 0; i < codeflowtrees.length; i++) {
            codeflowtrees[i].addEventListener("click", onCodeFlowTreeClicked);
        }

        document.getElementById("expandallcodeflow").addEventListener("click", onExpandAllClicked);
        document.getElementById("collapseallcodeflow").addEventListener("click", onCollapseAllClicked);
        document.getElementById("codeflowverbosity").addEventListener("change", onVerbosityChange);
    }
}

function initializeOpenedTab() {
    if (document.getElementById("codeflowtab")) {
        openTab("codeflowtab");
    } else {
        openTab("resultinfotab");
    }
}

/**
 * Callback when user clicks on the CodeFlow tree
 * @param event event fired when user clicked the codeflow tree
 */
function onCodeFlowTreeClicked(event) {
    let ele = event.srcElement;
    if (ele.className === "codeflowlocation") {
        ele = ele.parentElement;
    }

    if (ele.className.indexOf("unexpandable") === -1 && event.offsetX < 17/*width of the expand/collapse arrows*/) {
        toggleTreeElement(ele);
    } else {
        sendExplorerCallback({ request: "treeselectionchange", treeid_step: ele.id });
    }
}

/**
 * Callback when the user clicks the Collapse all button
 * @param event event fired when user clicked Collapse all button
 */
function onCollapseAllClicked(event) {
    toggleTreeElements("expanded", "collapsed");
}

/**
 * Callback when the user clicks the Expand all button
 * @param event event fired when user clicked Expand all button
 */
function onExpandAllClicked(event) {
    toggleTreeElements("collapsed", "expanded");
}

/**
 * Callback when a source link is clicked, this sends the call back to the extension to handle opening the source file
 * @param event event fired when a sourcelink was clicked
 */
function onSourceLinkClicked(event) {
    let ele = event.srcElement;

    sendExplorerCallback({
        request: "sourcelinkclicked",
        file: ele.dataset.file, line: ele.dataset.line, col: ele.dataset.col
    });
}

/**
 * Callback when a tab(Result Info, Code Flow, etc.) is clicked
 * @param event event fired when user clicked a tab
 */
function onTabClicked(event) {
    openTab(this.id);
}

/**
 * Callback when the verbosity setting is changed
 * @param event event fired when user changed the verbosity setting
 */
function onVerbosityChange(event) {
    updateTreeVerbosity();
    sendExplorerCallback({
        request: "verbositychanged",
        verbositystate: document.getElementById("codeflowverbosity").value,
    });
}

/**
 * This method will remove the tabactive and tabcontentactive from the current active tab
 * And add it to the tab that was clicked
 * @param id id of the tab that was clicked
 */
function openTab(id) {
    const activetab = document.getElementsByClassName("tab tabactive")[0];
    if (activetab !== undefined && activetab.id !== id) {
        activetab.className = "tab";
        document.getElementById(activetab.id + "content").className = "tabcontent";
    }

    document.getElementById(id).className = "tab tabactive";
    document.getElementById(id + "content").className = "tabcontent tabcontentactive";
}

/**
 * Sends a call back to the extension via calling the ExplorerCallback command
 * This is our method of telling the extension something happed in the Explorer webview
 * @param args object that will get sent to the ExplorerCallback command as a parameter
 */
function sendExplorerCallback(args) {
    window.parent.postMessage({
        command: "did-click-link",
        data: `command:extension.sarif.ExplorerCallback?${encodeURIComponent(JSON.stringify(args))}`,
    }, "file://");
}

/**
 * Sets the verbosity show state for each tree node that matches the passed in type
 * @param type type of the tree node("important" or "unimportant")
 * @param state verbosity show state to set the matching nodes to ("verbosityshow" or "verbosityhide")
 */
function setVerbosityShowState(type, state) {
    const elements = document.getElementsByClassName(type);
    for (let i = 0; i < elements.length; i++) {
        const classes = elements[i].className.split(" ");
        classes[TreeClassNames.VerbosityShowState] = state;
        elements[i].className = classes.join(" ");
    }
}

/**
 * Toggles an element to the passed in state, or the opposite of it's current if no state is passed in
 * @param ele element that needs to toggle
 * @param toggleToState state to toggle it to, if not defined it will determine it based on the current state
 */
function toggleTreeElement(ele, toggleToState) {
    const classNames = ele.className.split(" ");
    if (toggleToState === undefined) {
        if (classNames[TreeClassNames.ExpandState] === "expanded") {
            toggleToState = "collapsed";
        } else {
            toggleToState = "expanded";
        }
    }

    classNames[TreeClassNames.ExpandState] = toggleToState;
    ele.className = classNames.join(" ");
}

/**
 * Finds all of the elements in the trees that match the stateToToggle and changes it to the toggleToState
 * @param stateToToggle which state needs to be toggled ("collapsed" or "expanded")
 * @param toggleToState which state elements will be toggled to("collapsed" or "expanded")
 */
function toggleTreeElements(stateToToggle, toggleToState) {
    const treeroots = document.getElementsByClassName("codeflowtreeroot");
    for (let i = 0; i < treeroots.length; i++) {
        const elements = treeroots[i].getElementsByClassName(stateToToggle);
        while (elements.length > 0) {
            toggleTreeElement(elements[0], toggleToState);
        }
    }
}

/**
 * Updates the CodeFlow trees to only show the nodes based on the current verbosity setting
 */
function updateTreeVerbosity() {
    const hide = "verbosityhide";
    const show = "verbosityshow";
    const value = document.getElementById("codeflowverbosity").value;
    let importantClass;
    let unimportantClass;

    switch (value) {
        case "0":
            importantClass = hide;
            unimportantClass = hide;
            break;
        case "1":
            importantClass = show;
            unimportantClass = hide;
            break;
        case "2":
            importantClass = show;
            unimportantClass = show;
            break;
    }

    setVerbosityShowState("important", importantClass);
    setVerbosityShowState("unimportant", unimportantClass);
}

if (document.getElementById("codeflowtabcontent") !== null) {
    updateTreeVerbosity();
}

initializeOpenedTab();
addTooltips();
hookupEventListeners();
