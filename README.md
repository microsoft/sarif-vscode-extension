# Sarif Viewer

Visualizes the results contained in a 'Static Analysis Results Interchange Format' (SARIF) file. The viewer integrates with VS Code, displaying a list of analysis results and details in the Sarif Explorer, as well as in the source code.

Supports Sarif version '2.1.0'

## **Features**
 * Lists the results of open SARIF files in the Sarif Explorer (also shows up in Problems Panel)
 * Navigation to the source location of the result
 * Sarif Explorer shows details about the result:
    * Result info
    * Run info
    * Code flow steps
    * Attachments
    * Fixes
    * *new* Stacks
 * Supports embedded target files
 * Allows you to remap (in memory) source locations, if they can't be found using the location in the log file
 * Can set rootpaths in the settings for the extension to try when looking for files, ex. the rootpath of your local enlistment

### Code integration
 * Highlighting of the result location
 * Tooltips showing the message
 * Gutter icons to help identify the location of the result
 * Codeflow step regions are highlighted and labeled inline
 * Icons visualizing codeflow step level changes
    * ![Icons](/resources/readmeImages/CallReturnIcon.png?raw=true) Call with a Return
    * ![Icons](/resources/readmeImages/ReturnCallIcon.png?raw=true) Return from a Call
    * ![Icons](/resources/readmeImages/CallNoReturnIcon.png?raw=true) Call with no Return
    * ![Icons](/resources/readmeImages/ReturnNoCallIcon.png?raw=true) Return with no Call

### Convert Non-Sarif File
 * Can open and convert a non-sarif static analysis file to sarif for analysis - see ChangeLog update 2.5.0 for list of supported tools
    * To execute the convert command via the Command window(F1 key):
        1. Type in "Sarif: Convert and open a non-sarif file"
        2. Select the tool that generated the file
        3. In the file picker that opens up select the file

### Update Sarif Version
 * Can update older Sarif Versions to the latest version, on opening an older version a dialog lets you choose to:
    * Update to a temp file location
    * Update to a location via the save as dialog
    * Not update, you can view the original file but the results will not be loaded

### Sarif Explorer
 * Automatically launches when the first Sarif file is opened
 * Updates the Result Details Panel with the currently selected result in the Results List, Problems Panel, or in source code
 * Manually open it by typing "Sarif: Launch the Sarif Explorer" in the Command Palette(F1) or using the hotkey (Ctrl+L then Ctrl+E)

#### Results List
![Demo](/resources/readmeImages/ResultsList.gif?raw=true)
 * Available columns: Baseline State, Message, Result File, Position, Rule Id, Rule Name, Run Id, Sarif File, Severity, Kind, Rank, Tool, *new*Automation Category, *new* Automation Id
 * Group By: Results can be grouped by a column
    * Groups are sorted by number of results in each group
 * Sort By: Results are sortable by clicking the column header
 * Filter: Show/Hide the Filter input area by clicking the Filter icon
    * Toggle button for toggling Match Case
    * No wildcard support yet
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
 * Check here for known [issues](https://github.com/Microsoft/sarif-vscode-extension/issues)

## Feedback
Please post any feedback, suggestions or issues you have on the github repo issues page: https://github.com/Microsoft/sarif-vscode-extension/issues
