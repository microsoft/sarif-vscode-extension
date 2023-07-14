# Contributing to SARIF Viewer



## Overview
The instructions in this document will help you get started with the SARIF Viewer extension for Visual Studio Code.

This extension conforms to patterns common to all Visual Studio Code extensions. We recommend reading [the official guide](https://code.visualstudio.com/api/get-started/your-first-extension). That guide may overlap with some topics covered in this guide.

### Prerequisites
Proficiency of the following topics is required:
* Typescript (https://www.typescriptlang.org/)
* ReactJS (https://reactjs.org/)
* Visual Studio Code Extensions (https://code.visualstudio.com/api)

### Architecture
The extension is organized into two main parts:

* `/src/extension` - The main entry point. It runs within a `Node.js` process[^1] and can be thought of as a background task. It does not directly draw any UI.
* `/src/panel` - This runs within a [VS Code WebView](https://code.visualstudio.com/api/extension-guides/webview), which is essentially an `iframe`. This code is really just a web page which is rendered by ReactJS. In fact, during development, this page can be viewed directly in a browser.

As these two parts run in separate processes, communication is limited to [message passing](https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing). Shared logic is refactored into `/src/shared`.

[^1]: If running on the desktop. Otherwise see [here](https://code.visualstudio.com/api/advanced-topics/extension-host).



## Setup
Make sure you have [GIT](https://git-scm.com/), [Visual Studio Code](https://code.visualstudio.com/), and [Node.js](https://nodejs.org/en/).
For Node.js, the "LTS" version will be sufficient.

### Enlistment
Run `git clone https://github.com/microsoft/sarif-vscode-extension.git` or an equivalent command.

### Local Build
Build is already integrated with `F5`. If you must build separately, run `npx webpack`.



## Debugging
1) Place breakpoints at the first two "Key Break Point" locations (see below).
1) Start Debugging (`F5`). This will compile and run the extension in a new Extension Development Host window.
1) Run the `SARIF: Show Panel` command from the Command Palette in the new window. Your first breakpoint will hit.
1) Click "Open SARIF log" and pick a *.sarif file. Your second breakpoint will hit.
1) If you make changes to the source code, you can reload the Extension Development Host window by running the `Developer: Reload Window` command from the Command Palette of the that window.
1) To view console log output, run `Help > Toggle Developer Tools` from the menu of the Extension Development Host window.

### Key Break Points
* `src/extension/index.ts` function `activate` - This covers all the one-time preparation before any SARIF Logs are loaded.
* `src/extension/loadLogs.ts` function `loadLogs` - This runs each time one or more SARIF Logs are opened.
* `src/panel/indexStore.ts` function `IndexStore.constructor`- This is the core of the WebView which houses the bulk of the UI.



## FAQ
* Can I use [Visual Studio](https://visualstudio.microsoft.com/vs/) as my IDE? No, you must use Visual Studio Code.
* Is there a solution file? No, Visual Studio Code projects are just folders.



## Legal
This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
