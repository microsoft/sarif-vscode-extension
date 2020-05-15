// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export {}

declare global {
	const acquireVsCodeApi
	const vscode

	namespace NodeJS {
		interface Global {
			vscode
			fetch
		}
	}
}
