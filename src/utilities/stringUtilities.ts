/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * ------------------------------------------------------------------------------------------ */

'use strict';

import { Uri } from "vscode";

String.prototype.capitalizeFirstLetter = function(this: string): string {
    if (!this) {
        // Empty string
        return this;
    }

    if (this.length === 1) {
        return this.toUpperCase();
    }

    return this[0].toUpperCase() + this.substring(1).toLowerCase();
};

String.prototype.invariantEqual = function(this: string, thatString: string, ignoreCase?: 'Ignore Case'): boolean {
    return (ignoreCase === 'Ignore Case' ?
        this.localeCompare(thatString, 'root', {sensitivity: 'base'}) :
        this.localeCompare(thatString, 'root')) === 0;
};

String.prototype.filePathEqual = function(this: string, other: string): boolean {
    // For information on file path comparisons in Win32..
    // https://stackoverflow.com/questions/410502/win32-file-name-comparison/410562#410562
    // The short is they should be done using invariant upper-case comparisons.
    return other.toInvariantUpperCase().invariantEqual(this.toInvariantUpperCase());
};

String.prototype.toInvariantUpperCase = function(this: string): string {
    return this.toLocaleUpperCase('root');
};

Uri.prototype.filePathEqual = function(this: Uri, other: string | Uri): boolean {
    // For information on file path comparisons in Win32..
    // https://stackoverflow.com/questions/410502/win32-file-name-comparison/410562#410562
    // The short is they should be done using invariant upper-case comparisons.
    if (!this.scheme.invariantEqual('file', 'Ignore Case')) {
        throw new Error('Uri must be a file scheme.');
    }

    if (typeof other === 'string') {
        return other.toInvariantUpperCase().invariantEqual(this.fsPath.toInvariantUpperCase());
    }

    if (!other.scheme.invariantEqual('file', 'Ignore Case')) {
        throw new Error('Uri must be a file scheme.');
    }

    return other.fsPath.toInvariantUpperCase().invariantEqual(this.fsPath.toInvariantUpperCase());
};

Uri.prototype.isFile = function(this: Uri): boolean {
    return this.scheme.invariantEqual('file', 'Ignore Case');
};
