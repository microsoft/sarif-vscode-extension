/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */
import * as path from "path";
import glob from "glob";
import Mocha from "mocha";

// This is equiavelnt to "including" the generated javscript to get the code to run that sets the prototypes for the extension methods.
// If you don't do this... you crash using the extension methods.
import "../utilities/stringUtilities";

export function run(): Promise<void> {
    // Create the mocha test
    const mocha: Mocha = new Mocha({
        ui: "tdd",

        fullStackTrace: true,

        // Do not allow uncaught exceptions.
        allowUncaught: false
    });
    mocha.useColors(true);

    const testsRoot: string = __dirname;

    return new Promise((c, e) => {
        glob("**/**.test.js", { cwd: testsRoot }, (err: Error | null, files: string[]) => {
            if (err) {
                return e(err);
            }

            // Add files to the test suite
            files.forEach((file: string) => mocha.addFile(path.resolve(testsRoot, file)));

            // Run the mocha test
            mocha.run((failures) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        });
    });
}
