// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';

import { Extension } from '../extension';
import { UriHandler } from './uriHandler';
import { UriHandlerUtilities } from './uriHandlerUtilities';
import { UriMetadata } from './uriHandlerInterfaces';
import { startFloatingPromise } from '../utilities/promiseHelpers';

/**
 * Extension URI handler utilities for working with the entry help views.
 */
export class UriHelpViewUtilities {
    /**
     * Shows or hides the URI find or clone repository help view.
     * @param {boolean} show A flag indicating whether to show the view.
     * @returns {Promise<void>} A promise indicating that the view has been shown or hidden.
     */
    public static async showUriHelpView(show: boolean): Promise<void> {
        await vscode.commands.executeCommand('setContext', 'sarif-vscode.showUriHelpFindRepoSarif', show);
        await vscode.commands.executeCommand('uriHelpFindRepoSarif.focus');
    }

    /**
     * Dismisses an active URI help views.
     * @returns {Promise<void>} A promise indicating that the views have hidden.
     */
    public static async dismissUriHelpView(): Promise<void> {
        await UriHelpViewUtilities.showUriHelpView(false);
    }

    /**
     * Clones a repository from the URI help view.
     * @returns {Promise<void>} A promise indicating completion.
     */
    public static async cloneRepositoryFromUriHelpView(): Promise<void> {
        // Get the current URI repo name parameter from global state if we are in an active URI flow.
        const uriMetadata: UriMetadata | undefined = Extension.extensionContext.globalState.get<UriMetadata>(UriHandler.uriMetadataKey);
        if (uriMetadata?.repoName === 'undefined' || !uriMetadata) {
            // Hmm, well this is a bug. Log telemetry & pop an error message.
            startFloatingPromise(vscode.window.showErrorMessage(`Could not identify repository`), 'No need to wait on response.');
            // noRepoNameInUriHelpView
            return;
        }

        // If we successfully cloned the repo, continue the URI flow.
        // Otherwise, display a notification indicating clone was unsuccessful.
        const repoUri: vscode.Uri | undefined = await UriHandlerUtilities.cloneRepo(
            uriMetadata.sarifUri,
            uriMetadata.repoUri,
            uriMetadata.repoName,
            uriMetadata.organization,
            uriMetadata.project
        );

        if (repoUri) {
            // Continue URI flow. Do NOT open the repo, as cloneRepo already does that via git.clone.
            // I think we get here before the window reloads on itself because that happens via a *non-awaited*
            // vscode.commands.executeCommand and - given JS's single-threaded nature - it'll finish this code path
            // before executing the command. That's all just hypotheses, though - we could have a race condition here.

            await UriHandlerUtilities.saveRepoMapping(
                uriMetadata.repoName,
                repoUri,
                uriMetadata.title ?? undefined,
                uriMetadata.operationId
            );
        } else {
            // Show warning message.
            startFloatingPromise(vscode.window.showWarningMessage(`Unable to clone ${uriMetadata.repoName}`), 'No need to wait on response.');
            // repoNotClonedDuringUriHandling
        }

        // await UriHelpViewUtilities.showUriHelpView(false);
    }

    /**
     * Prompts the user with a folder selection dialog to select the relevant repository to map.
     * @returns {Promise<void>} A promise indicating completion.
     */
    public static async chooseRepositoryFolderFromUriHelpView(): Promise<void> {
        // Get the current URI repo name parameter from global state if we are in an active URI flow.
        const uriMetadata: UriMetadata | undefined = Extension.extensionContext.globalState.get<UriMetadata>(UriHandler.uriMetadataKey);
        if (uriMetadata?.repoName === 'undefined' || !uriMetadata) {
            // Hmm, well this is a bug. Log telemetry & pop an error message.
            startFloatingPromise(vscode.window.showErrorMessage(`Could not identify repository`), 'No need to wait on response.');
            // noRepoNameInUriHelpView
            return;
        }

        const repoNamePrompt: string = uriMetadata.repoName === 'null' ? 'repository' : uriMetadata.repoName;
        const openDialogOptions: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: `Select ${repoNamePrompt}`,
            title: `Navigate to ${repoNamePrompt}`
        };

        const fileUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog(openDialogOptions);
        if (!fileUri) {
            // noFolderSelectedFromOpenDialog
            return;
        }

        // eslint-disable-next-line prefer-destructuring
        const repoUri: vscode.Uri | undefined = fileUri[0];

        if (!repoUri) {
            return;
        }

        await UriHandlerUtilities.saveRepoMapping(
            uriMetadata.repoName,
            repoUri,
            uriMetadata.title ?? undefined,
            uriMetadata.operationId
        );

        await UriHandlerUtilities.openRepo(uriMetadata.sarifUri, uriMetadata.repoName, repoUri, uriMetadata.operationId);

        await UriHelpViewUtilities.showUriHelpView(false);
    }
}
