// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { AuthenticationHandler } from './authenticationHandler';
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

    public static signInMessage = 'In order to use WAVE Analysis, you must sign in';

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

        // // Register the VSCode automatic sign in flow command.
        // if (scopes.includes('499b84ac-1321-427f-aa17-267ca6975798/.default')) {
        //     this.disposables.push(vscode.commands.registerCommand('runAutoSignIn', this.runSignInFlow.bind(this)));
        // }
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
     * Get session information from vscode quietly
     * createIfNone currently works like:
     * If no auth session exists it will NOT start browser flow
     * If a matching auth session is found, but user hasnt grant wavework permission to use it, it will show a picklist asking user to select the matching account
     * @returns {Promise<vscode.AuthenticationSession | undefined>} The authentication sessions.
     */
    public async getSessionSilent(): Promise<vscode.AuthenticationSession | undefined> {
        try {
            const session: vscode.AuthenticationSession | undefined = await vscode.authentication.getSession(
                this.providerId,
                this.scopes,
                { createIfNone: false }
            );

            return session;
        } catch (error) {
            // errorOccurredDuringGetSessionSilent
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
                await this.runSignInFlow();
            }
        } catch (error) {
            // errorOccurredDuringGetSessionInteractive
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
            // errorOccurredDuringRunSignInFlow
        }

        return undefined;
    }
}
