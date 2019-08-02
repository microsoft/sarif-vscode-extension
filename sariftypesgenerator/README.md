# jsontotypescript README

This tool allows you to generate a consistently formatted Sarif typescript types definition file when updating the @types/sarif npm package.

# Features
* Interfaces and fields are ordered alphabetically to reduce churn noise when updating to a new schema.
* PropertiesBag will always be at the bottom of the interface if present
* Field types are correctly Typed when referencing other interfaces in the sarif schema

# Using
## Install
1. Install [Visual Studio Code](https://code.visualstudio.com/)
2. Clone the github repo: [Sarif-vscode-extension](https://github.com/microsoft/sarif-vscode-extension)

## Use
1. Open the project
2. Switch to the debug panel, and choose SarifTypesGenerator in the drop down, then start debugging
3. Press F1 and type in SarifGen and click enter
4. Choose the sarif schema .json file you want in the File picker
5. The extension will process the file and open a new file with the resulting types definitions

## Updating @types/sarif
1. Fork the [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) repo and clone the fork locally
2. navigate to the types/sarif folder
3. Update the index.d.ts file with the file you generated
4. Run the tests using: npm run lint sarif
    * If first time you will need to run "npm install" before running the test script above
5. Double check the file diff of the changes
6. Pull request the fork back to the main Definitely Typed repo
