# Sarif Viewer

Sarif Viewer extension for VSCode visualizes the results contained in a 'Static Analysis Results Interchange Format' (SARIF) file. The viewer integrates with VS Code, displaying a list of analysis results in the Problems panel and result details in the Sarif Explorer.

## Public Preview
Sarif Viewer is currently in public preview. We are currently still implementing features to support displaying additional data from the result.

## Features
 * Lists the results of open SARIF files in the Problems Panel
 * Navigation to the source location of the result
 * Sarif Explorer shows details about the result
 * Supports embedded target files
 * Allows you to remap(in memory) the source locations, if they can't be found

### Sarif Explorer:
 * Automatically launches when the first result is navigated to
 * Updates with the details of the selected result in Problems panel
 * Manually open it by typing "Sarif: Explorer" in the Command Palette(F1)

# Using
## Install
1. Install VS Code
2. Install the Sarif Viewer Extension
3. Reload VS Code

## Use
1. Open a .sarif file
2. Results will be loaded in the Problems Panel at the bottom
3. Click a result you'd like to navigate to and view details about

## Commands
Sariv Viewer provides the following commands in the Command Palette:
 * Sarif: Explorer: Launches the Sarif Explorer in the right panel

## Known Issues
 * Does not support Sarif V2
 * Does not have tabs in the Sarif Explorer for:
    * Callstacks
    * Fixes

## Release Notes

### 0.2.0
* Various Minor Fixes
### 0.1.0
* Initial preview release of the extension