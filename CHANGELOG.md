# Change Log

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
* Contributes sarif to the json language, which will allow VSCode to apply the sarif schema to the sarif file, which adds autocomplete and tooltips.
* Reworked how we create the Explorer window
* Added support for RuleKey
* Added support for Results that don't have a ResultLocation
* Various other Minor Fixes

## 0.1.0
* Initial preview release of the extension