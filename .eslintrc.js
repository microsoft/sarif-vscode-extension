const OFF = 0, ERROR = 2

module.exports = {
    overrides: [
        {
            files: ["src/**/*.ts{,x}"],
            extends: [
                "eslint:recommended",
                "plugin:@typescript-eslint/eslint-recommended",
                "plugin:@typescript-eslint/recommended"
            ],
            rules: {
                "new-cap": ERROR,
                "no-console": [ERROR, {allow: ["error", "warn"]}],
                "no-throw-literal": ERROR,
                "no-var": ERROR,
                "prefer-const": ERROR,

                "eqeqeq": ERROR,
                "filenames/match-regex": [ERROR, "^([a-z0-9]+)([A-Z][a-z0-9]+)*(\.(config|d|layouts|spec))?$"],
                "header/header": [ERROR, "line", [
                    " Copyright (c) Microsoft Corporation. All rights reserved.",
                    " Licensed under the MIT License.",
                ]],
                "indent": [ERROR, 4, { "SwitchCase": 1 }],
                "no-trailing-spaces": ERROR,
                "quotes": [ERROR, "single", {"allowTemplateLiterals": true}],
                "semi": ERROR,
                "@typescript-eslint/member-delimiter-style": [ERROR, {
                    "singleline": {
                        "delimiter": "comma",
                    }
                }],

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
