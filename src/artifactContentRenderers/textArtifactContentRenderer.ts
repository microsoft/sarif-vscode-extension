/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';
import * as sarif from 'sarif';
import { ArtifactContentRenderer } from './artifactContentRenderer';

/**
 * Class used to render artifact content objects with text.
 */
export class TextArtifactContentRenderer implements ArtifactContentRenderer {
    /**
     * Creates an instance of the binary content renderer.
     * @param contents The base 64 string contents to be rendered as markdown.
     */
    private constructor(private readonly contents: string) {
    }

    /**
     * @inheritdoc
     */
    public static tryCreateFromLog(log: sarif.Log, artifactContent: sarif.ArtifactContent, runIndex: number, artifactIndex: number): ArtifactContentRenderer | undefined {
        if (!artifactContent.text) {
            return undefined;
        }

        return new TextArtifactContentRenderer(artifactContent.text);
    }

    /**
     * Renders the contents as mark-down.
     * @param artifactUri The artifact URI to use as the file-name in the markdown.
     */
    public render(artifactUri: vscode.Uri): string {
        return this.contents;
    }
}
