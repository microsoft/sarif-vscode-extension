// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri, workspace } from 'vscode';

// Hacky: We are using `fs.stat` to test the existence of documents as VS Code does not provide a dedicated existence API.
// The similar Node `fs` API does not resolve custom URI schemes in the same way that VS Code does otherwise we would use that.
export default async function uriExists(absoluteUri: Uri) {
    try {
        await workspace.fs.stat(absoluteUri);
    } catch (error) {
        return false;
    }
    return true;
}
