/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import { Progress } from "vscode";

/**
 * Helper for the progress message in VSCode
 */
export class ProgressHelper {
    private static instance: ProgressHelper;

    private progress: Progress<{ message?: string; increment?: number}> | undefined;
    private progressMsg: string | undefined;
    private progressInc: number | undefined;

    public static get Instance(): ProgressHelper {
        if (!ProgressHelper.instance) {
            ProgressHelper.instance = new ProgressHelper();
        }

        return ProgressHelper.instance;
    }

    public get CurrentMessage(): string | undefined {
        return this.progressMsg;
    }

    public get CurrentIncrement(): number | undefined {
        return this.progressInc;
    }

    public set Progress(progress: Progress<{ message?: string; increment?: number }>) {
        this.progress = progress;
        this.progressMsg = undefined;
        this.progressInc = undefined;
    }

    /**
     * Updates the message and increment, only sets the report if a Progress object is set
     * @param message message to set on the progress dialog box
     * @param increment amount to fill the progress bar
     */
    public async setProgressReport(message?: string, increment?: number): Promise<void> {
        if (this.progress) {
            const update: { message?: string; increment?: number} = {};
            if (message) {
                this.progressMsg = message;
                update.message = message;
            }
            if (increment) {
                this.progressInc = increment;
                update.increment = increment;
            }
            this.progress.report(update);
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve();
                }, 100);
            });
        }
    }
}
