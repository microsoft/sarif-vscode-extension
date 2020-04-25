/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */
import * as assert from "assert";
import { checkForInsiderUpdates } from "../insidersUpdate/updateCheck";

suite("testUpgradeCheck",async function (this: Mocha.Suite): Promise<void> {
    test("Make sure Insiders version can be found", async function (this: Mocha.Context): Promise<void> {
        this.timeout('60s');
        assert.equal(await checkForInsiderUpdates('Just check'), true);
    });
});