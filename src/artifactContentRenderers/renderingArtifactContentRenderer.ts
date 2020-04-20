/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';
import * as sarif from 'sarif';
import { ArtifactContentRenderer } from './artifactContentRendering';

/**
 * Class used to render artifact content objects with text.
 */
export class RenderingArtifactContentRenderer implements ArtifactContentRenderer {
    /**
     * Creates an instance of the binary content renderer.
     * @param content The string contents to be rendered as markdown.
     */
    private constructor(protected readonly artifactContent: sarif.ArtifactContent) {
        if (!artifactContent.rendered || (!artifactContent.rendered.markdown && !artifactContent.rendered.text)) {
            throw new Error('Expected to have markdown or text content string');
        }
    }

    /**
     * Attempts to create an instance of the binary content renderer based on a SARIF log, run index and artifact index
     * Returns undefined if the artifact contents cannot be found, or the content is not binary content.
     * @param log The SARIF log.
     * @param runIndex The run index.
     * @param artifactIndex The artifact index.
     */
    public static tryCreateFromLog(log: sarif.Log, artifactContents: sarif.ArtifactContent, runIndex: number, artifactIndex: number): ArtifactContentRenderer | undefined {
        if (!artifactContents.rendered || (!artifactContents.rendered.markdown && !artifactContents.rendered.text)) {
            return undefined;
        }

        return new RenderingArtifactContentRenderer(artifactContents);
    }

    /**
     * Renders the contents as mark-down.
     * @param artifactUri The artifact URI to use as the file-name in the markdown.
     */
    public render(artifactUri: vscode.Uri): string {
        if (!this.artifactContent.rendered || (!this.artifactContent.rendered.markdown && !this.artifactContent.rendered.text)) {
            throw new Error('Expected to have markdown or text content string');
        }

        if (this.artifactContent.rendered.markdown) {
            // The text property required to be UTF8 per the spec.
            return new Buffer(this.artifactContent.rendered.markdown).toString('utf8');
        }

        // The text property required to be UTF8 per the spec.
        return new Buffer(this.artifactContent.rendered.text).toString('utf8');
    }
}
