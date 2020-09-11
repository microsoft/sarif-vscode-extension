// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Run `ncc build action.js --out .` to produce `index.js`
const { execFileSync } = require('child_process');
const core = require("@actions/core");
const { readFileSync, writeFileSync } = require('fs');
const { parse } = require('semver');

const package = JSON.parse(readFileSync('./package.json', 'utf8'));
const packageVer = parse(package.version);

let prerelease = 0; // Main was changed, or no prev version, restart prerelease from 0.
try {
	core.startGroup('Fetching tags');
	execFileSync('git', ['fetch', '--tags']);
	core.endGroup();

	core.startGroup('Looking for tags from commit history');
	core.info(execFileSync('git', ['log', '--oneline'], { encoding: 'utf8' }));
	// `abbrev=0` finds the closest tagname without any suffix.
	// HEAD~1 assuming the latest commit hasn't been tagged by this Action yet.
	const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD~1'], { encoding: 'utf8' }).trim();
	const lastReleaseVer = parse(tag);
	if (packageVer.compareMain(lastReleaseVer) === 0) {
		prerelease = lastReleaseVer.prerelease[0] + 1; // Main is equal, auto-increment the prerelease.
	}
	core.endGroup();
} catch (error) {
}

packageVer.prerelease = [ prerelease ];
package.version = packageVer.format();
core.info(`Computed package version: ${package.version}`);
writeFileSync('./package.json', JSON.stringify(package, null, 4));
core.setOutput("version", package.version);
