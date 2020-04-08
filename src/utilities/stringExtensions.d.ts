/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * ------------------------------------------------------------------------------------------ */

export {};

declare global {
    interface String {
        /**
         * Converts a string to locale invariant uppercase.
         */
        toInvariantUpperCase(): string;

        /**
         * Performs an locale invariant comparison.
         * @param other The string to compare to.
         * @param ignoreCase Specify 'Ignore Case' for case insensitive compare.
         */
        invariantEqual(other: string, ignoreCase?: 'Ignore Case'): boolean;

        /**
         * Capitalizes the first letter of the string, and lower-cases the rest.
         */
        capitalizeFirstLetter(): string;

        /**
         * Performs a comparison that is safe for file system paths (or path parts).
         * @param other The other file path to compare against.
         */
        filePathEqual(other: string): boolean;
    }
}

declare module 'vscode' {
    interface Uri {
        /**
         * Performs a comparison that is safe for file system paths (or path parts).
         * @param other The other file path to compare against.
         */
        filePathEqual(other: string | Uri): boolean;

        /**
         * Returns true if the scheme of the URI is 'file'.
         */
        isFile(): boolean;
    }
}