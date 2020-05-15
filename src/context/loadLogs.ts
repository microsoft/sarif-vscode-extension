// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { execSync } from 'child_process'
import * as fs from 'fs'
import jsonMap from 'json-source-map'
import { join } from 'path'
import { Log } from 'sarif'
import { eq, gt, lt } from 'semver'
import { tmpNameSync } from 'tmp'
import { ProgressLocation, Uri, window } from 'vscode'
import { Store } from '.'
import { augmentLog, JsonMap } from '../shared'

export async function loadLogs(uris: Uri[]) {
	const logs = uris
		.map(uri => {
			try {
				const file = fs.readFileSync(uri.fsPath, 'utf8')  // Assume scheme file.
					.replace(/^\uFEFF/, '') // Trim BOM.
				const {data: log, pointers} = jsonMap.parse(file) as { data: Log, pointers: JsonMap}
				log._uri = uri.toString()
				log._jsonMap = pointers
				return log
			} catch (error) {
				window.showErrorMessage(`Failed to parse '${uri.fsPath}'`)
				return undefined
			}
		})
		.filter(log => log)
	const logsNoUpgrade = [] as Log[]
	const logsToUpgrade = [] as Log[]
	const warnUpgradeExtension = logs.some(log => detectUpgrade(log, logsNoUpgrade, logsToUpgrade))
	const upgrades = logsToUpgrade.length
	if (upgrades) {
		await window.withProgress(
			{ location: ProgressLocation.Notification },
			async progress => {
				for (const [i, oldLog] of logsToUpgrade.entries()) {
					progress.report({
						message: `Upgrading ${i + 1} of ${upgrades} log${upgrades === 1 ? '' : 's'}...`,
						increment: 1 / upgrades * 100
					})
					await new Promise(r => setTimeout(r, 0)) // Await needed for progress to update
					const {fsPath} = Uri.parse(oldLog._uri)
					try {
						const tempPath = upgradeLog(fsPath)
						const file = fs.readFileSync(tempPath, 'utf8') // Assume scheme file.
						const {data: log, pointers} = jsonMap.parse(file) as { data: Log, pointers: JsonMap}
						log._uri = oldLog._uri
						log._uriUpgraded = Uri.file(tempPath).toString()
						log._jsonMap = pointers
						logsNoUpgrade.push(log)
					} catch (error) {
						window.showErrorMessage(`Failed to upgrade '${fsPath}'`)
					}
				}
			}
		)
	}
	logsNoUpgrade.forEach(augmentLog)
	if (warnUpgradeExtension) {
		window.showWarningMessage('Some log versions are newer than this extension.')
	}
	return logsNoUpgrade
}

export function detectUpgrade(log: Log, logsNoUpgrade: Log[], logsToUpgrade: Log[]) {
	const {version} = log
	if (!version || lt(version, '2.1.0')) {
		logsToUpgrade.push(log)
	} else if (gt(version, '2.1.0')) {
		return true // warnUpgradeExtension
	} else if (eq(version, '2.1.0')) {
		const schema = log.$schema
			?.replace('http://json.schemastore.org/sarif-', '')
			?.replace('https://schemastore.azurewebsites.net/schemas/json/sarif-', '')
			?.replace(/\.json$/, '')
		if (schema === undefined || schema === '2.1.0-rtm.5') {
			logsNoUpgrade.push(log)
		} else {
			logsToUpgrade.push(log)
		}
	}
	return false
}

export function upgradeLog(path: string) {
	const name = tmpNameSync({ postfix: '.sarif' })
	const multitoolExe = `Sarif.Multitool${process.platform === 'win32' ? '.exe' : ''}`
	const multitoolExePath = join(Store.extensionPath || process.cwd(), 'out', multitoolExe)
	execSync(`${multitoolExePath} transform "${path}" --force --pretty-print --output "${name}"`)
	return name
}
