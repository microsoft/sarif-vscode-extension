// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const CopyPlugin = require("copy-webpack-plugin");
const outputPath = require('path').join(__dirname, 'out');

const common = {
    resolve: {
        extensions: ['.js', '.ts', '.tsx'] // .js is neccesary for transitive imports
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: [{
                    loader: 'ts-loader',
                    options: { transpileOnly: true }, // 4x speed increase, but no type checks.
                }],
            },
            {
                test: /\.s?css$/,
                use:  ['style-loader', 'css-loader', 'sass-loader'],
            },
            {
                test: /\.ttf$/,
                type: 'asset/resource'
            },
        ]
    },

    devtool: 'source-map', // 'inline-source-map' hits breakpoints more reliability, but inflate file size.
    output: {
        filename: '[name].js', // Default, consider omitting.
        path: outputPath,
    },

    stats: {
        all: false,
        assets: true,
        builtAt: true,
        errors: true,
        performance: true,
        timings: true,
    },
};

module.exports = [
    {
        ...common,
        name: 'Panel', // Ordered 1st for devServer. https://github.com/webpack/webpack/issues/1849
        entry: { panel: './src/panel/index.tsx' },
        output: {
            ...common.output,
            libraryTarget: 'umd',
            globalObject: 'this',
        },
        devServer : {
            client: {
                overlay: {
                    errors: true,
                    warnings: false, // Workaround for: "Module not found: Error: Can't resolve 'applicationinsights-native-metrics' in '.../node_modules/applicationinsights/out/AutoCollection'"
                },
            },
            static: {
                directory: __dirname, // Otherwise will default to /public
            },
            port: 8000
        },
        performance: {
            hints: 'warning',
            maxAssetSize: 400 * 1024,
            maxEntrypointSize: 400 * 1024,
        },
        plugins: [
            new CopyPlugin({
                patterns: [ 'src/panel/init.js' ],
            }),
        ],
    },
    {
        ...common,
        name: 'Context',
        entry: { context: './src/extension/index.ts' },
        output: {
            ...common.output,
            libraryTarget: 'commonjs2',
            devtoolModuleFilenameTemplate: '../[resource-path]' // https://code.visualstudio.com/api/working-with-extensions/bundling-extension#configure-webpack
        },
        target: 'node',
        externals: {
            fsevents: 'fsevents',
            vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded.
        },
    },
];
