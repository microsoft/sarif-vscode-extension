/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { SarifVersion } from "../common/interfaces";
import { FileConverter } from "../fileConverter";

suite("canUpgradeVersion", () => {
    // @ts-ignore parseVersion is private
    const v2FullCSDVersion = FileConverter.parseVersion("2.0.0-csd.2.beta.2018-10-10");
    // @ts-ignore parseVersion is private
    const v2FullRTMVersion = FileConverter.parseVersion("2.0.0-rtm.2");
    // @ts-ignore parseVersion is private
    const v2Version = FileConverter.parseVersion("2.0.0");

    const older = true;
    const newer = false;
    const same = false;

    /**
     * sets the current version, calls the isOlderThenVersion function and verifies the expected result
     * @param curVersion current SarifVersion to set as curVersion
     * @param compareVersion version to check against current
     * @param expectedEqualValue expected return value of the isOlderThenVersion call
     */
    function callIsOlderThenVersion(compareVersion: string, curVersion: SarifVersion, expectedEqualValue: boolean) {
        // @ts-ignore curVersion is private
        FileConverter.curVersion = curVersion;

        // @ts-ignore parseVersion is private
        const parsedVer = FileConverter.parseVersion(compareVersion);

        // @ts-ignore isOlderThenVersion is private but ignoring so we can call directly
        const canUpgrade = FileConverter.isOlderThenVersion(parsedVer, curVersion);

        assert.equal(canUpgrade, expectedEqualValue, `Parsed: ${parsedVer.original}, Current: ${curVersion.original}`);
    }

    test("v1", () => {
        const fileVersion = "1.0.0";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, older);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, older);
    });

    test("v1 with csd", () => {
        const fileVersion = "1.0.0-csd.2.beta.2018-10-10";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, older);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, older);
    });

    test("matches v2Version", () => {
        const fileVersion = "2.0.0";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, same);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, newer);
    });

    test("v2 older csd", () => {
        const fileVersion = "2.0.0-csd.1.beta.2018-5-10";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, older);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, older);
    });

    test("v2 older csd date", () => {
        const fileVersion = "2.0.0-csd.2.beta.2018-8-10";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, older);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, older);
    });

    test("matches v2FullCSDVersion", () => {
        const fileVersion = "2.0.0-csd.2.beta.2018-10-10";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, older);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, same);
    });

    test("v2 newer csd date", () => {
        const fileVersion = "2.0.0-csd.2.beta.2018-12-10";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, older);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, newer);
    });

    test("v2 rtm older", () => {
        const fileVersion = "2.0.0-rtm.1";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, older);
        callIsOlderThenVersion(fileVersion, v2Version, newer);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, newer);
    });

    test("matches v2FullRTMVersion", () => {
        const fileVersion = "2.0.0-rtm.2";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, same);
        callIsOlderThenVersion(fileVersion, v2Version, newer);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, newer);
    });

    test("v2 rtm newer", () => {
        const fileVersion = "2.0.0-rtm.3";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, newer);
        callIsOlderThenVersion(fileVersion, v2Version, newer);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, newer);
    });

    test("v3", () => {
        const fileVersion = "3.0.0";
        callIsOlderThenVersion(fileVersion, v2FullRTMVersion, newer);
        callIsOlderThenVersion(fileVersion, v2Version, newer);
        callIsOlderThenVersion(fileVersion, v2FullCSDVersion, newer);
    });
});

suite("parseVersion", () => {
    /**
     * Seperated this call to reduce the number of @ts-ignore comments as parseVersion is private
     * @param version version to parse
     */
    function callParseVersion(version: string): SarifVersion {
        // @ts-ignore parseVersion is private but ingnoring for testing
        return FileConverter.parseVersion(version);
    }

    test("full csd version", () => {
        const version = "2.0.0-csd.2.beta.2018-9-10";
        const parsedVer: SarifVersion = callParseVersion(version);
        assert.deepEqual(parsedVer, {
            csd: 2, csdDate: new Date(2018, 9, 10), major: 2, minor: 0, original: version, sub: 0,
        });
    });

    test("rtm version", () => {
        const version = "2.0.0-rtm.2";
        const parsedVer = callParseVersion(version);
        assert.deepEqual(parsedVer, { major: 2, minor: 0, original: version, rtm: 2, sub: 0 } as SarifVersion);
    });

    test("v1", () => {
        const version = "1.0.0";
        const parsedVer = callParseVersion(version);
        assert.deepEqual(parsedVer, { major: 1, minor: 0, original: version, sub: 0 } as SarifVersion);
    });

    test("v1.2.3", () => {
        const version = "1.2.3";
        const parsedVer = callParseVersion(version);
        assert.deepEqual(parsedVer, { major: 1, minor: 2, original: version, sub: 3 } as SarifVersion);
    });
});

suite("parseSchemaVersion", () => {
    /**
     * Seperated this call to reduce the number of @ts-ignore comments as parseSchema is private
     * @param version version to parse
     */
    function callParseSchema(version: string): SarifVersion {
        const schemaPrefix = "http://json.schemastore.org/sarif-";
        // @ts-ignore parseSchema is private but ingnoring for testing
        return FileConverter.parseSchema(vscode.Uri.parse(`${schemaPrefix}${version}`, /*strict*/ true));
    }

    test("full csd version", () => {
        const version = "2.0.0-csd.2.beta.2018-9-10";
        const parsedVer = callParseSchema(version);
        assert.deepEqual(parsedVer, {
            csd: 2, csdDate: new Date(2018, 9, 10), major: 2, minor: 0, original: version, sub: 0,
        } as SarifVersion);
    });

    test("rtm version", () => {
        const version = "2.0.0-rtm.2";
        const parsedVer = callParseSchema(version);
        assert.deepEqual(parsedVer, { major: 2, minor: 0, original: version, rtm: 2, sub: 0 } as SarifVersion);
    });

    test("v1", () => {
        const version = "1.0.0";
        const parsedVer = callParseSchema(version);
        assert.deepEqual(parsedVer, { major: 1, minor: 0, original: version, sub: 0 } as SarifVersion);
    });

    test("v1.2.3", () => {
        const version = "1.2.3";
        const parsedVer = callParseSchema(version);
        assert.deepEqual(parsedVer, { major: 1, minor: 2, original: version, sub: 3 } as SarifVersion);
    });

    test("2.1.0 with alternative schema with json end", () => {
        const ver = "2.1.0";
        const fullVer = vscode.Uri.parse(`https://githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-${ver}.json`, /*strict*/ true);
        // @ts-ignore parseSchema is private but ingnoring for testing
        const parsedVer = FileConverter.parseSchema(fullVer);
        assert.deepEqual(parsedVer, { major: 2, minor: 1, original: ver, sub: 0 } as SarifVersion);
    });

    test("full csd with alternative schema with json end", () => {
        const ver = "2.0.0-csd.2.beta.2018-9-10";
        const fullVer =  vscode.Uri.parse(`https://githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-${ver}.json`, /*strict*/ true);
        // @ts-ignore parseSchema is private but ingnoring for testing
        const parsedVer = FileConverter.parseSchema(fullVer);
        assert.deepEqual(parsedVer, {
            csd: 2, csdDate: new Date(2018, 9, 10), major: 2, minor: 0, original: ver, sub: 0,
        } as SarifVersion);
    });
});
