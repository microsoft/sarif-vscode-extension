// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Run `ncc build action.js --out .` to produce `index.js`
const { execFileSync } = require('child_process');
const core = require("@actions/core");
const { readFileSync, writeFileSync } = require('fs');
const { parse } = require('semver');

const package = JSON.parse(readFileSync('./package.json', 'utf8'));
const packageVer = parse(package.version);

let prerelease = 11; // Main was changed, or no prev version, restart prerelease from 0.
packageVer.prerelease = [ prerelease ];
package.version = packageVer.format();
core.info(`Computed package version: ${package.version}`);
writeFileSync('./package.json', JSON.stringify(package, null, 4));
core.setOutput("version", package.version);
