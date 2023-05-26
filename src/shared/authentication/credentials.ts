/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * --------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AuthenticationHandler } from './authenticationHandler';
import { WaveAnalysisExtensionTelemetry } from '../telemetry/waveAnalysisExtensionTelemetry';
import { startFloatingPromise } from '../utilities/promiseHelpers';

/**
 * Uses VSCode's authentication provider model to sign users into Microsoft.
 * Initial flow will open a browser asking users to login to their Microsoft account.
 * VSCode auth model supports shared sessions so if a session exists (from another extension) that targets
 * the same resource (ADO) and scopes, it will simply ask users to select the account from a picklist.
 */
export class Credentials implements vscode.Disposable {
    // The list of objects that need to be disposed.
    private disposables: vscode.Disposable[] = [];

    private providerId: string;

    private scopes: string[];

    public static signInMessage: string = 'In order to use WAVE Analysis, you must sign in';

    public static signInMessageItem: vscode.MessageItem = {
        title: 'Sign In'
    };

    public constructor(providerId: string, scopes: string[], signInMessage?: string) {
        this.providerId = providerId;

        // This is poorly documented, but it 'offline_access' appears to be needed in order for vscode to utlize refresh token pattern
        this.scopes = [
            ...scopes,
            'offline_access'
        ];

        if (signInMessage) {
            Credentials.signInMessage = signInMessage;
        }

        // Register the VSCode automatic sign in flow command.
        if (scopes.includes('499b84ac-1321-427f-aa17-267ca6975798/.default')) {
            // This doesn't use WAVE_ANALYSIS_EXTENSION_NAME because it's actually imported before that gets exported!
            this.disposables.push(vscode.commands.registerCommand('waveAnalysis.runAutoSignIn', this.runSignInFlow.bind(this)));
        }
    }

    /**
     * @inheritdoc
     */
    public dispose(): void {
        vscode.Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    public async getSession(): Promise<vscode.AuthenticationSession | undefined> {
        let session = await this.getSessionSilent();
        if (!session) {
            session = await this.getSessionInteractive();
        }

        return session;
    }

    /**
     * Get session information from vscode quietly.
     * @returns {Promise<vscode.AuthenticationSession | undefined>} The authentication sessions.
     */
    public async getSessionSilent(): Promise<vscode.AuthenticationSession | undefined> {
        try {
            const session: vscode.AuthenticationSession | undefined = await vscode.authentication.getSession(
                this.providerId,
                this.scopes,
                { silent: true }
            );

            return session;
        } catch (error) {
            WaveAnalysisExtensionTelemetry.telemetry.reportException(error as Error, {
                providerId: this.providerId,
                tag: 'errorOccurredDuringGetSessionSilent'
            });
        }

        return undefined;
    }

    private async getSessionInteractive(): Promise<vscode.AuthenticationSession | undefined> {
        try {
            const response: vscode.MessageItem | undefined = await vscode.window.showInformationMessage(
                Credentials.signInMessage,
                Credentials.signInMessageItem
            );

            if (response === Credentials.signInMessageItem) {
                return this.runSignInFlow();
            }
        } catch (error) {
            WaveAnalysisExtensionTelemetry.telemetry.reportException(error as Error, {
                providerId: this.providerId,
                tag: 'errorOccurredDuringGetSessionInteractive'
            });
        }

        return undefined;
    }

    /**
     * Performs login flow, if a session doesnt already exists it will open a
     * modal dialog asking users to sign in using the browser
     * @returns {Promise<vscode.AuthenticationSession | undefined>} The authentication sessions.
     */
    public async runSignInFlow(): Promise<vscode.AuthenticationSession | undefined> {
        try {
            const session: vscode.AuthenticationSession | undefined = await vscode.authentication.getSession(
                this.providerId,
                this.scopes,
                { createIfNone: true }
            );

            await AuthenticationHandler.setSignedInContext(Boolean(session));
            return session;
        } catch (error) {
            startFloatingPromise(vscode.window.showInformationMessage('Error signing into Azure DevOps, please try again'), 'No need to wait on the UI.');
            WaveAnalysisExtensionTelemetry.telemetry.reportException(error as Error, {
                providerId: this.providerId,
                tag: 'errorOccurredDuringRunSignInFlow'
            });
        }

        return undefined;
    }
}
