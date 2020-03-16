/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

export function getDocumentElementById<T extends  Element>(document: Document, id: string, constructor: { new (): T  } ): T {
    const element: Element | null = document.getElementById(id);

    if (!(element instanceof constructor)) {
        throw new Error(`Could not find element with id ${id}`);
    }

    return <T>element;
}
