// OFF = 0, ERROR = 2
const WARN = 1

module.exports = {
	overrides: [
		{
			files: ["src/**/*.ts{,x}"],
			rules: {
				"new-cap": WARN,
				"no-console": [WARN, {allow: ["error", "warn"]}],
				"no-debugger": WARN,
				"no-throw-literal": WARN,
				"no-var": WARN,
				"prefer-const": WARN,

				"eqeqeq": WARN,
				"filenames/match-regex": [WARN, "^([a-z0-9]+)([A-Z][a-z0-9]+)*(\.d|\.spec)?$"],
				"header/header": [WARN, "line", [
					" Copyright (c) Microsoft Corporation. All rights reserved.",
					" Licensed under the MIT License.",
				]],
				"no-trailing-spaces": WARN,
				"quotes": [WARN, "single", {"allowTemplateLiterals": true}],
				"semi": [WARN, "never"],
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
