const CopyPlugin = require('copy-webpack-plugin')
const outputPath = require('path').join(__dirname, 'out')

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
				use: 'url-loader',
			},
		]
	},

	mode: 'production',
	devtool: 'source-map', // 'inline-source-map' hits breakpoints more reliability, but inflate file size.
	output: {
		filename: '[name].js',
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
}

module.exports = [
	{
		...common,
		name: 'Panel', // Ordered 1st for devServer. https://github.com/webpack/webpack/issues/1849
		entry: { panel: './src/panel/Index.tsx' },
		output: {
			...common.output,
			libraryTarget: 'umd',
			globalObject: 'this',
		},
		devServer : {
			// index: 'devServer.html', // Not working.
			port: 8000,
			stats: 'none',
		},
		performance: {
			hints: 'warning',
			maxAssetSize: 400 * 1024,
			maxEntrypointSize: 400 * 1024,
		},
	},
	{
		...common,
		name: 'Context',
		entry: { context: './src/context/index.ts' },
		output: {
			...common.output,
			libraryTarget: 'commonjs2',
			devtoolModuleFilenameTemplate: '../[resource-path]' // https://code.visualstudio.com/api/working-with-extensions/bundling-extension#configure-webpack
		},
		target: 'node',
		externals: {
			vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded.
		},
		plugins: [
			new CopyPlugin([
				{ from: require('@microsoft/sarif-multitool-darwin') },
				{ from: require('@microsoft/sarif-multitool-win32') },
			]),
		],
	},
]
