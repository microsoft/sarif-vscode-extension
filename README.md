# Sarif Viewer

Visualizes the results contained in a 'Static Analysis Results Interchange Format' (SARIF) file. The viewer integrates with VS Code, displaying a list of analysis results in the Problems panel and result details in the Sarif Explorer.

*Note: Version 2.0.0+ does not currently support Sarif V1. If you need this support do not update. If you need to rollback to Version 1.0.0 see [Rollback](#rollback) section*

## Features
 * Lists the results of open SARIF files in the Problems Panel
 * Navigation to the source location of the result
 * Sarif Explorer shows details about the result:
    * Result info
    * Run info
    * Code flow steps
    * Attachments
 * Supports embedded target files
 * Allows you to remap (in memory) source locations, if they can't be found using the location in the log file
 * Can set rootpaths in the settings for the extension to try when looking for files, ex. the rootpath of your local enlistment
 * Can open and convert a non-sarif static analysis file to sarif for analysis - see ChangeLog for list of supported tools
    * To execute the convert command via the Command window(F1 key):
        1. Type in "Sarif: Convert and open a non-sarif file"
        2. Select the tool that generated the file
        3. In the file picker that opens up select the file

### Sarif Explorer:
 * Automatically launches when the first result is navigated to
 * Updates with the details of the selected result in Problems panel
 * Manually open it by typing "Sarif: Launch the Sarif Explorer" in the Command Palette(F1) or using the hotkey (Ctrl+L then Ctrl+E)

#### *new* Results List:
![Demo](/resources/readmeImages/ResultsList.gif?raw=true)
 * Available columns: Message, Result File, Position, Rule Id, Rule Name, Run Id, Sarif File, Severity
 * Group By: Results can be grouped by a column
    * Groups are sorted by number of results in each group
 * Sort By: Results are sortable by clicking the column header
 * Hide/Show columns: Visibility of each column can be toggled by clicking the Eye icon
 * Clicking a result in the list will navigate to the source and display the details in the Sarif Explorer
 * Persistence: Group By, Sort By, and Hidden columns are persisted in settings

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

## Known Issues
 * Version 2.0.0+ does not currently support Sarif V1
 * Sarif Explorer does not yet have: 
    * Callstacks tab for displaying callstack data
    * Fixes tab for displaying fix data

## Feedback
Please post any feedback or issues you would like to report here: https://github.com/Microsoft/sarif-vscode-extension/issues

## Rollback 
Instructions to rollback the version installed if you need Sarif V1 support:
1. Download the version 1.0.0 vsixpackage from the store:
    * https://ms-sarifvscode.gallery.vsassets.io/_apis/public/gallery/publisher/MS-SarifVSCode/extension/sarif-viewer/1.0.0/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage
2. Change the extension of the file you downloaded from .vsixpackage to .vsix
3. In VSCode press the F1 key, then type in and hit enter:
    * Extensions: Install from vsix 
4. Choose the vsix file and install the extension
5. Disable auto update of extensions, add to your settings:
    * "extensions.autoUpdate": false
