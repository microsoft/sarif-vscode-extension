// ERROR = 2
const OFF = 0, WARN = 1

module.exports = {
	overrides: [
		{
			files: ["src/**/*.ts{,x}"], // 'index.js', 'webpack.config.js'
			extends: [
				"eslint:recommended",
				"plugin:@typescript-eslint/eslint-recommended",
				"plugin:@typescript-eslint/recommended"
			],
			rules: {
				"new-cap": WARN,
				"no-console": [WARN, {allow: ["error", "warn"]}],
				"no-throw-literal": WARN,
				"no-var": WARN,
				"prefer-const": WARN,

				"eqeqeq": WARN,
				"filenames/match-regex": [WARN, "^([a-z0-9]+)([A-Z][a-z0-9]+)*(\.(config|d|spec))?$"],
				"header/header": [WARN, "line", [
					" Copyright (c) Microsoft Corporation. All rights reserved.",
					" Licensed under the MIT License.",
				]],
				"no-trailing-spaces": WARN,
				"quotes": [WARN, "single", {"allowTemplateLiterals": true}],
				"semi": WARN,

				// Exceptions with Justifications.
				"no-undef": OFF, // Requires too many exception account for Mocha, Node.js and browser globals. Typescript also already checks for this.
				"@typescript-eslint/explicit-module-boundary-types": OFF, // Requires types on methods such as render() which can already be inferred.
				"@typescript-eslint/no-empty-function": OFF, // Too useful for mocks. Perhaps TODO enable for only non-test files.
				"@typescript-eslint/no-non-null-assertion": OFF, // Rule does not account for when the value has already been null-checked.
				"@typescript-eslint/no-unused-vars": OFF, // Not working with TSX.
				"@typescript-eslint/no-var-requires": OFF, // Making importing proxyquire too verbose since that library is not super Typescript friendly.
				"@typescript-eslint/triple-slash-reference": OFF, // Disallows <reference path="../panel/global.d.ts" /> and there's no workaround.
			},
		}
	],
	parser: "@typescript-eslint/parser",
	parserOptions: {
		ecmaVersion: 6,
		sourceType: "module",
		"ecmaFeatures": {
			"jsx": true
		},
	},
	plugins: [
		"@typescript-eslint",
		"filenames",
		"header",
	],
}
