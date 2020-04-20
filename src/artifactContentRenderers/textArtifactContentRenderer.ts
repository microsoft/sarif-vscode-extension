/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';
import * as sarif from 'sarif';
import { ArtifactContentRenderer } from './artifactContentRendering';

/**
 * Class used to render artifact content objects with text.
 */
export class TextArtifactContentRenderer implements ArtifactContentRenderer {
    /**
     * The binary string contents.
     */
    private readonly contents: string;

    /**
     * Creates an instance of the binary content renderer.
     * @param content The string contents to be rendered as markdown.
     */
    private constructor(protected readonly artifactContent: sarif.ArtifactContent) {
        if (!artifactContent.text) {
            throw new Error('Expected to have text content string');
        }

        this.contents = artifactContent.text;
    }

    /**
     * Attempts to create an instance of the binary content renderer based on a SARIF log, run index and artifact index
     * Returns undefined if the artifact contents cannot be found, or the content is not binary content.
     * @param log The SARIF log.
     * @param runIndex The run index.
     * @param artifactIndex The artifact index.
     */
    public static tryCreateFromLog(log: sarif.Log, artifactContents: sarif.ArtifactContent, runIndex: number, artifactIndex: number): ArtifactContentRenderer | undefined {
        if (!artifactContents.text) {
            return undefined;
        }

        return new TextArtifactContentRenderer(artifactContents);
    }

    /**
     * Renders the contents as mark-down.
     * @param artifactUri The artifact URI to use as the file-name in the markdown.
     */
    public render(artifactUri: vscode.Uri): string {
        // The text property required to be UTF8 per the spec.
        return new Buffer(this.contents).toString('utf8');
    }
}
