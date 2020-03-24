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
    private currentProgress: { message?: string; increment?: number} | undefined;

    public static get Instance(): ProgressHelper {
        if (!ProgressHelper.instance) {
            ProgressHelper.instance = new ProgressHelper();
        }

        return ProgressHelper.instance;
    }

    public get CurrentMessage(): string | undefined {
        return this.currentProgress && this.currentProgress.message;
    }

    public get CurrentIncrement(): number | undefined {
        return this.currentProgress && this.currentProgress.increment;
    }

    public set Progress(progress: Progress<{ message?: string; increment?: number }> | undefined) {
        this.progress = progress;
    }

    /**
     * Updates the message and increment, only sets the report if a Progress object is set
     * @param message message to set on the progress dialog box
     * @param increment amount to fill the progress bar
     */
    public async setProgressReport(message?: string, increment?: number): Promise<void> {
        if (this.progress) {
            const update: { message?: string; increment?: number} = {
                message,
                increment
            };
            this.progress.report(update);
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve();
                }, 100);
            });
        }
    }
}
