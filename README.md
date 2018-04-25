# Sarif Viewer

Visualizes the results contained in a 'Static Analysis Results Interchange Format' (SARIF) file. The viewer integrates with VS Code, displaying a list of analysis results in the Problems panel and result details in the Sarif Explorer.

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
 * Does not yet support Sarif V2
 * Sarif Explorer does not yet have: 
    * Callstacks tab for displaying callstack data
    * Fixes tab for displaying fix data

## Feedback
Please post any feedback or issues you would like to report here: https://github.com/Microsoft/sarif-vscode-extension/issues
