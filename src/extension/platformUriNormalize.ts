// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import platform from './platform';

export default function(uri: string): string {
    if (platform === 'win32' && Uri.parse(uri).scheme === 'file') {
        return uri.toLowerCase();
    }
    return uri;
}
