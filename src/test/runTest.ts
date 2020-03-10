/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

 import * as path from "path";

import { runTests } from "vscode-test";

async function main(): Promise<void> {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath: string = path.resolve(__dirname, "../../");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath: string = path.resolve(__dirname, "./suite/index");

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        // @ts-ignore it's ok to console log in tests
        console.error("Failed to run tests");
        process.exit(1);
    }
}

main().then(() => {
    console.log("Test run completed.");
}, (err) => {
    console.error("Failed to run tests.");
});
