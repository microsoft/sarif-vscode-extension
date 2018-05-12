# Sarif Viewer

Visualizes the results contained in a 'Static Analysis Results Interchange Format' (SARIF) file. The viewer integrates with VS Code, displaying a list of analysis results in the Problems panel and result details in the Sarif Explorer.

*Note: Version 2.0.0 does not currently support Sarif V1. If you need this support do not update. If you need to rollback to Version 1.0.0 see [Rollback](#rollback) section*

## Features
 * Lists the results of open SARIF files in the Problems Panel
 * Navigation to the source location of the result
 * Sarif Explorer shows details about the result
    * Result info
    * Run info
    * CodeFlow data
 * Supports embedded target files
 * Allows you to remap (in memory) source locations, if they can't be found using the location in the log file

### Sarif Explorer:
 * Automatically launches when the first result is navigated to
 * Updates with the details of the selected result in Problems panel
 * Manually open it by typing "Sarif: Explorer" in the Command Palette(F1)

# Using
## Install
1. Install [Visual Studio Code](https://code.visualstudio.com/)
2. Install the Sarif Viewer Extension
3. Reload VS Code


## Use
1. Open a .sarif file
2. Results will show up the Problems Panel
3. Click the result you're investigating:
    * The editor will navigate to the location
    * The Sarif Explorer will open with the result details

## Commands
Sarif Viewer provides the following commands in the Command Palette:
 * Sarif: Explorer: Launches the Sarif Explorer in the right panel

## Known Issues
 * Sarif Explorer does not yet have: 
    * Callstacks tab for displaying callstack data
    * Fixes tab for displaying fix data
 * This version does not currently support Sarif V1

## Feedback
Please post any feedback or issues you would like to report here: https://github.com/Microsoft/sarif-vscode-extension/issues

## Rollback 
If you need Sarif V1 support follow instructions from *Q: Can I download an extension directly from the Marketplace?* in the Common Questions at the bottom of [Extension Marketplace](https://code.visualstudio.com/docs/editor/extension-gallery) page using this url for the version 1.0.0 vsix:
* https://ms-sarifvscode.gallery.vsassets.io/_apis/public/gallery/publisher/MS-SarifVSCode/extension/sarif-viewer/1.0.0/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage

