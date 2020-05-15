// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { https } from 'follow-redirects'
import fs from 'fs'
import { tmpNameSync } from 'tmp'
import { commands, ProgressLocation, Uri, window } from 'vscode'
import '../shared/extension'

// Usage:
// commands.registerCommand('sarif.updateExtension', async () => await update())
export async function update() {
	const fileName = tmpNameSync({ postfix: '.vsix' })
	const stream = fs.createWriteStream(fileName)
	const url = new URL('https://github.com/jeffersonking/sarif-vscode/releases/download/Latest/sarif-vscode-0.0.0.vsix')
	await window.withProgress(
		{ location: ProgressLocation.Notification },
		async progress => {
			await new Promise(resolve => {
				const MB = 1024 * 1024
				https.get({
					hostname: url.hostname,
					path: url.pathname,
					headers: { 'User-Agent': 'microsoft.sarif-viewer' }
				}, response => {
					const totalBytes = +response.headers['content-length']
					const totalMB = (totalBytes / MB).toFixed(0)
					let progressBytes = 0
					response.pipe(stream)
					response.on('data', chunk => {
						progressBytes += chunk.length
						const progressMB = (progressBytes / MB).toFixed(0)
						progress.report({
							message: `Downloading update. ${progressMB} of ${totalMB}MB...`,
							increment: chunk.length / totalBytes * 100
						})
					})
					response.on('end', resolve)
				})
			})
		}
	)
	if (await window.showInformationMessage(`Updated downloaded. Ready to install.`, 'Install and Reload')) {
		await commands.executeCommand('workbench.extensions.installExtension', Uri.file(fileName))
		await commands.executeCommand('workbench.action.reloadWindow')
	}
}
