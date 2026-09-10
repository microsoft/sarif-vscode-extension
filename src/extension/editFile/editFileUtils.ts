
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export type SuppressionEditTpe = 'add' | 'update' | 'remove';

// Helper function to find the position of a json property
export function find_property_at(text: string, property: string, index: number, pos?: number): number {
    let currentPos = text.indexOf(`"${property}"`, pos);
    if (currentPos === -1) return -1;

    // Find the colon after the property name
    currentPos = text.indexOf(':', currentPos);
    if (currentPos === -1) return -1;

    // Find the opening bracket or brace
    let openChar = text.indexOf('[', currentPos);
    const openCurly = text.indexOf('{', currentPos);
    if (openChar === -1 || (openCurly !== -1 && openCurly < openChar)) {
        openChar = openCurly;
    }
    if (openChar === -1) return -1;

    currentPos = openChar;

    // Navigate to the specific index
    for (let i = 0; i <= index; i++) {
        currentPos = text.indexOf('{', currentPos + 1);
        if (currentPos === -1) return -1;
        if (i < index) {
            currentPos = findMatchingBrace(text, currentPos);
            if (currentPos === -1) return -1;
        }
    }

    return currentPos;
}

// Helper function to find the matching closing brace
export function findMatchingBrace(text: string, start: number): number {
    let braceCount = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') {
            braceCount++;
        } else if (text[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
                return i;
            }
        }
    }
    return -1;
}

// Helper function to find the matching closing brace
export function findMatchingBracket(text: string, start: number): number {
    let bracket = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '[') {
            bracket++;
        } else if (text[i] === ']') {
            bracket--;
            if (bracket === 0) {
                return i;
            }
        }
    }
    return -1;
}

// Helper function to determine the spacing of the original sarif file
export function detectJsonIndentation(jsonString: string): number | string {
    const match = jsonString.match(/\n(\s+)/);

    if (match) {
        const indentation = match[1];
        if (indentation.includes('\t')) {
            return '\t';
        } else {
            return indentation.length;
        }
    }

    return 0;
}