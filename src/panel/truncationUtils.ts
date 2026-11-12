// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as React from 'react';

/**
 * Utility functions for conditionally showing tooltips only when text is truncated
 */

/**
 * Simple utility to check if an element needs a tooltip based on truncation
 * This function should be called after the element has been rendered and laid out
 */
export function shouldShowTooltip(element: HTMLElement | null, text: string): boolean {
    if (!element || !text) return false;
    return element.scrollWidth > element.clientWidth;
}

/**
 * Creates tooltip props conditionally based on whether text is truncated
 * This is meant to be used with a ref callback to check truncation after render
 */
export function getConditionalTooltipProps(text: string, isTruncated: boolean): { title?: string } {
    return isTruncated ? { title: text } : {};
}

/**
 * Higher-order function that creates a span element with conditional tooltip
 * based on text truncation. This is designed to work with existing render patterns.
 */
export function createTruncatedSpan(
    text: string,
    className = '',
    additionalProps: React.HTMLAttributes<HTMLSpanElement> = {}
): React.ReactElement {
    let spanRef: HTMLSpanElement | null = null;
    let tooltipApplied = false;

    const setRef = (element: HTMLSpanElement | null) => {
        spanRef = element;
        if (element && !tooltipApplied) {
            // Use setTimeout to ensure layout is complete
            setTimeout(() => {
                if (shouldShowTooltip(element, text)) {
                    element.setAttribute('title', text);
                }
                tooltipApplied = true;
            }, 0);
        }
    };

    return React.createElement('span', {
        ref: setRef,
        className,
        ...additionalProps
    }, text);
}
