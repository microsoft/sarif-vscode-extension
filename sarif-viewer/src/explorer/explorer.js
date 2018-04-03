// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/

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

    const codeflowtrees = document.getElementsByClassName("codeflowtreeroot");
    for (let i = 0; i < codeflowtrees.length; i++) {
        codeflowtrees[i].addEventListener("click", onCodeFlowTreeClicked);
    }

    document.getElementById("expandallcodeflow").addEventListener("click", onExpandAllClicked);
    document.getElementById("collapseallcodeflow").addEventListener("click", onCollapseAllClicked);
    document.getElementById("codeflowverbosity").addEventListener("change", onVerbosityChange);
}

/**
 * Callback when user clicks on the CodeFlow tree
 * @param event event fired when user clicked the codeflow tree
 */
function onCodeFlowTreeClicked(event) {
    const ele = event.srcElement;
    if (ele.className.indexOf("unexpandable") === -1 && event.offsetX < 17/*width of the expand/collapse arrows*/) {
        toggleExpandedState(ele);
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
    toggleExpandedState("collapsed", "expanded");
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
        classes[2] = state;
        elements[i].className = classes.join(" ");
    }
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
            const classNames = elements[0].className.split(" ");
            classNames[0] = toggleToState;
            elements[0].className = classNames.join(" ");
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

updateTreeVerbosity();
addTooltips();
hookupEventListeners();
