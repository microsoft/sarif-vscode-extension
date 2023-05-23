// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Subscription } from '@azure/arm-subscriptions';
import { extensions, commands } from 'vscode';
import { AzureAccountExtensionApi, AzureSession } from './azureAccountApi';
import { TokenCredentialsBase } from '@azure/ms-rest-nodeauth';

export type AuthorizationToken = {
    header: string;
    expiresAt: number | undefined;
}

const azureAccount = extensions.getExtension<AzureAccountExtensionApi>('ms-vscode.azure-account')?.exports;

export async function askForLogin(): Promise<void> {
    await commands.executeCommand('azure-account.askForLogin');
}

export async function getAllSubscriptions(): Promise<Subscription[]> {
    if (!isLoggedIn()) {
        await askForLogin();
        await azureAccount?.waitForLogin();
    }

    const subscriptions: Subscription[] = [];
    if (azureAccount) {
        for (const azureSubscription of azureAccount.subscriptions) {
            subscriptions.push(azureSubscription.subscription);
        }
    }

    return subscriptions;
}

export async function getSessions(): Promise<AzureSession[] | undefined> {
    if (!isLoggedIn()) {
        await askForLogin();
        await azureAccount?.waitForLogin();
    }
    return azureAccount?.sessions;
}

export async function getAuthorizationToken(): Promise<AuthorizationToken> {
    const sessions = await getSessions();
    if (!sessions || sessions.length <= 0) {
        throw Error('No Azure sessions found');
    }

    const session = sessions[0];
    if (session.credentials2 instanceof TokenCredentialsBase) {
        const token = await session.credentials2.getToken();
        return {
            header: `Bearer ${token.accessToken}`,
            expiresAt: token.expiresIn
        };
    } else {
        const scope = 'https://management.azure.com/.default';
        const token = await session.credentials2.getToken(scope);
        return {
            header: `Bearer ${token?.token}`,
            expiresAt: token?.expiresOnTimestamp
        };
    }
}

function isLoggedIn(): boolean {
    return azureAccount?.status === 'LoggedIn';
}
