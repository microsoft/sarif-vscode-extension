// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as assert from "assert";
import { SarifVersion } from "../common/Interfaces";
import { FileConverter } from "../FileConverter";

suite("canUpgradeVersion", () => {
    // @ts-ignore parseVersion is private
    const v2FullVersion = FileConverter.parseVersion("2.0.0-csd.2.beta.2018-10-10");
    // @ts-ignore parseVersion is private
    const v2Version = FileConverter.parseVersion("2.0.0");

    /**
     * sets the current version, calls the canUpgradeVersion function and verifies the expected result
     * @param curVersion current SarifVersion to set as curVersion
     * @param compareVersion version to check against current
     * @param expectedEqual expected return value of the canUpgradeVersion call
     */
    function callCanUpgradeVersion(curVersion: SarifVersion, compareVersion: string, expectedEqual: boolean) {
        // @ts-ignore curVersion is private
        FileConverter.curVersion = curVersion;

        // @ts-ignore canUpgradeVersion is private but ignoring so we can call directly
        const canUpgrade = FileConverter.canUpgradeVersion(compareVersion);

        assert.equal(canUpgrade, expectedEqual);
    }

    test("v1", () => {
        const version = "1.0.0";
        callCanUpgradeVersion(v2FullVersion, version, true);
        callCanUpgradeVersion(v2Version, version, true);
    });

    test("v1 with csd", () => {
        const version = "1.0.0-csd.2.beta.2018-10-10";
        callCanUpgradeVersion(v2FullVersion, version, true);
        callCanUpgradeVersion(v2Version, version, true);
    });

    test("v2", () => {
        const version = "2.0.0";
        callCanUpgradeVersion(v2FullVersion, version, true);
        callCanUpgradeVersion(v2Version, version, false);
    });

    test("v2 older csd", () => {
        const version = "2.0.0-csd.1.beta.2018-5-10";
        callCanUpgradeVersion(v2FullVersion, version, true);
        callCanUpgradeVersion(v2Version, version, false);
    });

    test("v2 older csd date", () => {
        const version = "2.0.0-csd.2.beta.2018-8-10";
        callCanUpgradeVersion(v2FullVersion, version, true);
        callCanUpgradeVersion(v2Version, version, false);
    });

    test("current version", () => {
        const version = "2.0.0-csd.2.beta.2018-10-10";
        callCanUpgradeVersion(v2FullVersion, version, false);
        callCanUpgradeVersion(v2Version, version, false);
    });

    test("v2 newer csd date", () => {
        const version = "2.0.0-csd.2.beta.2018-12-10";
        callCanUpgradeVersion(v2FullVersion, version, false);
        callCanUpgradeVersion(v2Version, version, false);
    });

    test("v3", () => {
        const version = "3.0.0";
        callCanUpgradeVersion(v2FullVersion, version, false);
        callCanUpgradeVersion(v2Version, version, false);
    });
});

suite("parseVersion", () => {
    /**
     * Seperated this call to reduce the number of @ts-ignore comments as parseVerion is private
     * @param version version to parse
     */
    function callParseVersion(version: string): SarifVersion {
        // @ts-ignore parseVersion is private but ingnoring for testing
        return FileConverter.parseVersion(version);
    }

    test("full version", () => {
        const parsedVer = callParseVersion("2.0.0-csd.2.beta.2018-9-10");
        assert.deepEqual(parsedVer, {
            csd: 2, csdDate: new Date(2018, 9, 10), major: 2, minor: 0, sub: 0,
        } as SarifVersion);
    });

    test("v1", () => {
        const parsedVer = callParseVersion("1.0.0");
        assert.deepEqual(parsedVer, {
            major: 1, minor: 0, sub: 0,
        } as SarifVersion);
    });

    test("v1.2.3", () => {
        const parsedVer = callParseVersion("1.2.3");
        assert.deepEqual(parsedVer, {
            major: 1, minor: 2, sub: 3,
        } as SarifVersion);
    });
});
