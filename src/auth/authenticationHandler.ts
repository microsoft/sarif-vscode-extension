// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as azdev from 'azure-devops-node-api';
import * as azdoInterfaces from 'azure-devops-node-api/interfaces/common/VsoBaseInterfaces';
import * as vscode from 'vscode';
import { WebApi, getBearerHandler } from 'azure-devops-node-api';
import { Credentials } from './Credentials';
import { getAdoFileContent } from './adoClient';
import { getUserEmailFromJwt } from '../utilities/jwtUtilities';

export const authRepoId = 'f7f61573-9961-47f0-9dfe-937f2cde7461';

interface metadataJson {

    /**
     * The Component Governance vulnerability service endpoint.
     */
    vulnerabilityService: string;
}

interface IAuthenticationHandler {

    /**
     * Retreives the users alias from the sign in flow
     */
    getUserAlias(): Promise<string>;

    /**
     * Retreives a ready to go IRequestHandler that can be used with
     * azure-devops-node-api requests.
     */
    getAuthorizedRequestHandlerAsync(): Promise<azdoInterfaces.IRequestHandler>;
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

    public async getAuthorizedRequestHandlerAsync(): Promise<azdoInterfaces.IRequestHandler> {
        const session = await this.credentials.getSession();
        const token = session?.accessToken ?? '';
        return getBearerHandler(token);
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
        await vscode.commands.executeCommand('setContext', 'sarif-vscode.signedIn', signedIn);

        // Once we know signedIn context is assigned, set loading to false to allow the auth view to be displayed if needed.
        await vscode.commands.executeCommand('setContext', 'sarif-vscode.loading', false);
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
    ['499b84ac-1321-427f-aa17-267ca6975798/.default']
);

/**
 * Handler used to authenticate to S360 APIs.
 * Hat tip to https://www.eliostruyf.com/microsoft-authentication-provider-visual-studio-code/.
 */
export const S360AuthenticationHandler: AuthenticationHandler = new AuthenticationHandler(
    'microsoft',
    [
        // Use our own client ID to authenticate. Of course, this isn't documented anywhere.
        // https://github.com/microsoft/vscode/blob/1.73.1/extensions/microsoft-authentication/src/AADHelper.ts#L610-L630
        // WAVE Analysis: https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/496719b1-dc2e-4adb-9d15-48372642ccfb
        'VSCODE_CLIENT_ID:496719b1-dc2e-4adb-9d15-48372642ccfb',
        // Microsoft tenant
        'VSCODE_TENANT:72f988bf-86f1-41af-91ab-2d7cd011db47',
        // But wait! Isn't this our own app ID? Why yes, yes it is.
        // S360 Test doesn't support scope-based auth at the moment and only checks to see if the audience is on their "known-good" list.
        // Hence...request a token for ourselves so that the audience is correct.
        '496719b1-dc2e-4adb-9d15-48372642ccfb/.default'
        // Later on we'll want this...
        // S360 Test: https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/b04e3c97-71b3-4855-bf22-0128fdda8f44
        // 'https://microsoft.onmicrosoft.com/Service360Test/user_impersonation'
    ]
);

/**
 * Get connection.
 * @param {Promise<WebApi>} organization The ADO organization to get the connection for.
 * @returns {Promise<WebApi>}  Returns a promise that when complete.
 */
export async function getConnection(organization: string): Promise<WebApi> {
    const orgUrl = `https://dev.azure.com/${organization}`;
    const handler: azdoInterfaces.IRequestHandler = await AdoAuthenticationHandler.getAuthorizedRequestHandlerAsync();
    return new azdev.WebApi(orgUrl, handler);
}

/**
 * Gets the auth connection and file contents from Azure DevOps needed to access the vulnerability service endpoint.
 * @returns {string | undefined} A string containing the vulnerability service endpoint or undefined.
 */
export async function getFileContentAuth(): Promise<string | undefined> {
    const contents: string | undefined = await getAdoFileContent(
        'microsoft',
        authRepoId,
        'main',
        'vulnerabilityExtension.json'
    );

    const contentsJson: metadataJson = JSON.parse(contents) as metadataJson;
    if (!contentsJson || !contentsJson.vulnerabilityService) {
        // unableToRetrieveVulnerabilityServiceEndpoint
    }

    return contentsJson.vulnerabilityService;
}
