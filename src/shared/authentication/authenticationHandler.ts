// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { Credentials } from './credentials';
import { getUserEmailFromJwt } from './jwtUtilities';

//const sarifViewClientId = 'dde281b2-f277-479b-9c1c-2e84bd84092f';
//const sarifViewerClientId = '496719b1-dc2e-4adb-9d15-48372642ccfb';
const sarifViewerClientId = 'b86035bd-b0d6-48e8-aa8e-ac09b247525b';
const microsoftTenantId = '72f988bf-86f1-41af-91ab-2d7cd011db47';

interface IAuthenticationHandler {

    /**
     * Retrieves the users alias from the sign in flow
     */
    getUserAlias(): Promise<string>;
}

/**
 * Wrapper used to get a valid token from vscode for the specified resource/scope.
 */
export class AuthenticationHandler implements IAuthenticationHandler {
    private credentials: Credentials;

    public static isSignedIn = false;

    public constructor(providerId: string, scopes: string[], signInMessage?: string) {
        this.credentials = new Credentials(providerId, scopes, signInMessage);
    }

    public async getAccessToken(): Promise<string | undefined> {
        const session = await this.credentials.getSession();
        return session?.accessToken;
    }

    public async getUserAlias(): Promise<string> {
        const email: string | undefined = await this.getUserEmail();
        return email?.split('@')?.[0] ?? email ?? 'unknown';
    }

    public async getUserEmail(): Promise<string | undefined> {
        const session: vscode.AuthenticationSession | undefined = await this.credentials?.getSession();
        return getUserEmailFromJwt(session?.accessToken);
    }

    public async isSignedIn(): Promise<boolean> {
        const session: vscode.AuthenticationSession | undefined = await this.credentials.getSessionSilent();

        if (!session) {
            await AuthenticationHandler.setSignedInContext(false);
            return false;
        }

        const email = getUserEmailFromJwt(session?.accessToken);
        if (!email || !(email.endsWith('@microsoft.com') || email.endsWith('.microsoft.com'))) {
            await AuthenticationHandler.setSignedInContext(false);
            return false;
        }

        AuthenticationHandler.isSignedIn = true;
        await AuthenticationHandler.setSignedInContext(true);
        return true;
    }

    public async waitForSignIn(): Promise<void> {
        if (await this.isSignedIn()) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            const disposable = vscode.authentication.onDidChangeSessions((event) => {
                if (event.provider.id === 'microsoft') {
                    if (this.credentials.getSessionSilent() !== undefined) {
                        disposable.dispose();
                        resolve();
                    }
                }
            });
        });
    }

    /**
     * Prompts the user to sign in.
     * @param {boolean} warning A flag indicating whether the message is a warning or informational.
     * @returns {Promise<void>} A value indicating whether the user clicked Sign In or not.
     */
    public async runSignInPrompt(warning?: boolean): Promise<boolean> {
        const signedIn: boolean = await this.isSignedIn();

        if (signedIn) {
            return true;
        }

        let response: vscode.MessageItem | undefined;

        if (warning) {
            response = await vscode.window.showWarningMessage(
                Credentials.signInMessage,
                Credentials.signInMessageItem
            );
        } else {
            response = await vscode.window.showInformationMessage(
                Credentials.signInMessage,
                Credentials.signInMessageItem
            );
        }

        if (response === Credentials.signInMessageItem) {
            const session: vscode.AuthenticationSession | undefined = await this.credentials.runSignInFlow();
            AuthenticationHandler.isSignedIn = Boolean(session);
            return session !== undefined;
        }

        return false;
    }

    /**
     * Sets the signedIn and loading contexts.
     * @param {boolean | undefined} signedIn The signed in state to set.
     * @returns {Promise<void>} A value indicating completion when the contexts have been updated.
     */
    public static async setSignedInContext(signedIn: boolean | undefined): Promise<void> {
        await vscode.commands.executeCommand('setContext', `sarifViewer.signedIn`, signedIn);

        // Once we know signedIn context is assigned, set loading to false to allow the auth view to be displayed if needed.
        await vscode.commands.executeCommand('setContext', `sarifViewer.loading`, false);
    }
}

// We split these up because:
// * Azure DevOps has a terrible AAD implementation where its ONLY scope is user_impersonation,
//   meaning that _theoretically_ we could do anything we wanted to on their behalf,
//   even though all we need is read access to one repo & their account/project info.
// * Thus, the ADO permission is "Important" risk, which means that all owners must have SC-ALT accounts.
//   We do not have SC-ALT accounts.
// * HOWEVER, the built-in Microsoft authentication provider _can_ authenticate with ADO!
// * On the other hand, it can't authenticate to any internal apps, like S360.
// * That solution's easy enough - create a separate AAD app to do those authorizations.
// * ...and now we have two authentication handlers.

/**
 * Handler used to authenticate to ADO APIs.
 * ADO resource ID: https://ms.portal.azure.com/#blade/Microsoft_AAD_IAM/ManagedAppMenuBlade/Overview/objectId/71dba5a0-a77c-4b64-bcc4-f5f98be267fe/appId/499b84ac-1321-427f-aa17-267ca6975798
 */
export const AdoAuthenticationHandler: AuthenticationHandler = new AuthenticationHandler(
    'microsoft',
    [
        `VSCODE_CLIENT_ID:${sarifViewerClientId}`,
        `VSCODE_TENANT:${microsoftTenantId}`,
        //'VSCODE_TENANT:common',
        '499b84ac-1321-427f-aa17-267ca6975798/.default'
    ]
);
