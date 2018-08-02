# Legal

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

# Prerequisites
* Install VSCode
* Clone the repository to a local folder

# Build/Debug Extension
1. Open the local repo folder up in VSCode
2. First time you’ll need to:
    * install npm modules, run "npm install" 
    * install tslint, run "npm install -g tslint"
3. Run BuildExplorer task the first time and anytime you modify the webviewer.ts file(task compiles the Sarif Explorer typescript without the module code, because the webview doesn’t have commonjs)
    1. Click the Tasks on the top bar
    2. Click Run Task
    3. Type in BuildExplorer and hit enter to run the BuildExplorer task
4. Press F5 to launch a VSCode instance with the extension loaded

# Package Extension
1. Open cmd prompt to the local repo folder 
    * you can also open the cmd line in vscode’s Integrated Terminal panel
2. First time you’ll need to:
    * install vsce module, run "npm install -g vsce"
3. run "vsce package"

sarif-viewer-`<version>`.vsix will be created(`version` is defined in the package.json and package-lock.json files)

Instructions pulled from: [publish extension](https://code.visualstudio.com/docs/extensions/publish-extension)

# Install Package
1. Open cmd prompt to the location of the vsix package 
    * you can also open the cmd line in vscode’s Integrated Terminal panel
2. run "code --install-extension sarif-viewer-`<version>`.vsix"

Instructions pulled from: [install from a vsix](https://code.visualstudio.com/docs/editor/extension-gallery#_install-from-a-vsix)

