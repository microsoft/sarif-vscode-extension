# Change Log

## 2.2.0
* Reworked the UX of remapping a file when it can't be found
    * Opens an input box with instructions and populated with the file that can't be found
    * Shows the file in the instructions for reference as well
    * Allows a user to enter a folder path(ex. the root of your enlistment), that will be added to the settings as a root path and checked in the future before asking the user for a file path
* Changed the Sarif Explorer from a previewHTML panel to a webview panel
* Added when you click a code lens or key navigate to a different codeflow step it will now highlight the step in the Sarif Explorer
* Improved maintaining state of the Sarif Explorer after navigating away to a different file in the same view column and then back
* Fixed the Sarif Explorer taking focus when you click a diagnostic in the problems panel

## 2.1.0
* Added codelenses to display the messages for the codeflow steps inline
    * The messages show based on the verbosity switch in the Sarif Explorer CodeFlow panel
* Added diagnostics severity gutter icons to help show the selected result's location
* Added call and return icons
    * These inline icons will help visually describe if a call returns or not, or if a return has a call or not
* Added keyboard navigation through the codeflow steps
    * After selecting a codeflow step, press ctrl+F10 for the next step or ctrl+F9 for previous step

## 2.0.1
* Security fix for a node module included in the dependencies [details](https://nvd.nist.gov/vuln/detail/CVE-2018-3728)

## 2.0.0
* Updated to support Sarif V2.0.0 (we no longer support Sarif V1, a future task would be to add backwards support)
* Added Related Locations to Result Info panel
* Added Properties to Result and Run Info panels
* Added Embedded Link support
* Added Attachments panel
* Changed Locations and Related Locations to be clickable links
* Added instructions to Readme how to downgrade to previous version to maintain Sarif V1 support

## 1.0.0
* Prep work to get it ready for releasing on the marketplace
* Contributes Sarif to the json language, which will allow VSCode to apply the Sarif schema to the Sarif file, which adds autocomplete and tooltips.
* Reworked how we create the Explorer window
* Added support for RuleKey
* Added support for Results that don't have a ResultLocation
* Various other Minor Fixes

## 0.1.0
* Initial preview release of the extension