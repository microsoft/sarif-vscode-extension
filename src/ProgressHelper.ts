// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import { Progress } from "vscode";

/**
 * Helper for the progress message in VSCode
 */
export class ProgressHelper {
    private static instance: ProgressHelper;

    private progress: Progress<{ message?: string; increment?: number; }>;
    private progressMsg: string;
    private progressInc: number;

    public static get Instance(): ProgressHelper {
        if (ProgressHelper.instance === undefined) {
            ProgressHelper.instance = new ProgressHelper();
        }

        return ProgressHelper.instance;
    }

    public get CurrentMessage(): string {
        return this.progressMsg;
    }

    public get CurrentIncrement(): number {
        return this.progressInc;
    }

    public set Progress(progress: Progress<{ message?: string; increment?: number; }>) {
        this.progress = progress;
        this.progressMsg = undefined;
        this.progressInc = undefined;
    }

    /**
     * Updates the message and increment, only sets the report if a Progress object is set
     * @param message message to set on the progress dialog box
     * @param increment amount to fill the progress bar
     */
    public async setProgressReport(message?: string, increment?: number) {
        if (this.progress !== undefined) {
            const update: { message?: string; increment?: number; } = {};
            if (message !== undefined) {
                this.progressMsg = message;
                update.message = message;
            }
            if (increment !== undefined) {
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
