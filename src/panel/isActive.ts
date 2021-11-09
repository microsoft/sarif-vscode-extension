// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Using `document.hasFocus()` as the indicator of if this panel is active or not.
export function isActive() {
    return document.hasFocus();
}
