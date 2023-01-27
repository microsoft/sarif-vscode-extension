// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-unsafe-call */

/**
   A promise or a function that returns a promise.
 */
type PromiseFunctionOrPromise<T> = (Thenable<T> | (() => Thenable<T>));

/**
 * Intentionally starts a floating promise. This should ONLY be used when you really do not care
 * about waiting for a promise to complete.
 * This function will send a telemetry event in the case of a failed promise.
 * @param {PromiseFunctionOrPromise<T>} promiseFunction The function to execute as an ignored promise.
 * @param {string} justification The reason it is okay to start this as a floating promise.
 * @returns {void}
 */
export function startFloatingPromise<T>(promiseFunction: PromiseFunctionOrPromise<T>, justification: string): void {
    if (!justification || justification.length === 0) {
        throw new Error('Cannot use this function without providing a justification.');
    }

    const promise: Thenable<T> = typeof promiseFunction === 'function' ? new Promise<T>((resolve, reject) => {
        try {
            resolve(promiseFunction());
        } catch (error) {
            reject(error);
        }
    }) : promiseFunction;

    promise.then(
        () => {
            // Do nothing, the promise has completed.
        },
        (rejectedReason) => {
            if (rejectedReason instanceof Error) {
                /*
                * When using JSON.stringify(), only an object's enumerable properties are serialized.
                * If the object doesn't have enumerable properties, it will print as an empty object.
                * To fix this, we can use the replacer argument for JSON.stringify() which will convert
                * the object to a regular object that can be "stringified". More info here:
                * https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
                */
                // eslint-disable-next-line prefer-reflect

                // reportFloatingPromiseRejected
            } else {
                // const message: string = rejectedReason instanceof Object ? JSON.stringify(rejectedReason) : 'Floating promise failed for unknown reason';
                // message, JSON.stringify(rejectedReason), justification
            }
        }
    );
}

const criticalPromises: Promise<void>[] = [];

/**
 * Starts a critical promise that is tracked until the promise completes.
 * This is mainly used to ensure that promises are complete during deactivation of the extension.
 * An example of this is when a new folder is added to a code workspace, we update the known set of "build directories"
 * to include the new folder. If we don't "await" the critical promises during deactivation, then the saving
 * of the new folder in the settings is never completed and the new folder does not show up in the "build directories" view.
 * NOTE: There should be very few places this is used.
 * @param {PromiseFunctionOrPromise<T>} promiseFunction A promise or a function that returns a promise that will be tracked as critical.
 * @returns {PromiseFunctionOrPromise<T>} Returns the promise function.
 */
export function startCriticalPromise<T>(promiseFunction: PromiseFunctionOrPromise<T>): PromiseFunctionOrPromise<T> {
    // eslint-disable-next-line require-jsdoc
    function removeCriticalPromise(promise: Promise<void>): void {
        const indxOfPromise: number = criticalPromises.indexOf(promise);
        if (indxOfPromise >= 0) {
            criticalPromises.splice(indxOfPromise, 1);
        }
    }

    const wrappedPromise: Promise<T> = new Promise<T>((resolve, reject) => {
        const criticalPromise: Promise<void> = new Promise((resolveCriticalPromise) => {
            const promise: Thenable<T> = typeof promiseFunction === 'function' ? promiseFunction() : promiseFunction;
            promise.then(
                (resolvedValue: T) => {
                    removeCriticalPromise(criticalPromise);
                    resolveCriticalPromise();
                    resolve(resolvedValue);
                },
                (rejectedReason) => {
                    removeCriticalPromise(criticalPromise);
                    resolveCriticalPromise();
                    reject(rejectedReason);
                }
            );
        });

        criticalPromises.push(criticalPromise);
    });

    return wrappedPromise;
}

/**
 * Waits for the known critical promises to be completed.
 * @returns {Promise<void>} Waits for critical promises to be completed.
 */
export async function waitForCriticalPromises(): Promise<void> {
    await Promise.all(criticalPromises);
}