// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import platform from './platform';

export default function(uri: Uri): Uri {
    if (platform === 'win32' && uri.scheme === 'file') {
        return Uri.parse(uri.toString().toLowerCase(), true);
    }
    return uri;
}
