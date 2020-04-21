/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from 'vscode';
import * as sarif from 'sarif';
import { ArtifactContentRenderer } from './artifactContentRenderer';

/**
 * Class used to render artifact content objects with text.
 */
export class RenderingArtifactContentRenderer implements ArtifactContentRenderer {
    private readonly renderedContent: sarif.MultiformatMessageString;
    public readonly specificUriExtension?: string;

    private static tryGetMessageStringFrom(artifactContent: sarif.ArtifactContent): sarif.MultiformatMessageString | undefined {
        if (artifactContent.rendered !== undefined && (artifactContent.rendered.markdown !== undefined || artifactContent.rendered.text?.length !== 0)) {
            return artifactContent.rendered;
        }

        return undefined;
    }

    /**
     * Creates an instance of the binary content renderer.
     * @param content The string contents to be rendered as markdown.
     */
    private constructor(protected readonly artifactContent: sarif.ArtifactContent) {
        const messageString: sarif.MultiformatMessageString | undefined = RenderingArtifactContentRenderer.tryGetMessageStringFrom(artifactContent);
        if (!messageString) {
            throw new Error('Expected to have markdown or text content string');
        }

        this.renderedContent = messageString;
        this.specificUriExtension = messageString.markdown ? 'md' : undefined;
    }

    /**
     * @inheritdoc
     */
    public static tryCreateFromLog(log: sarif.Log, artifactContent: sarif.ArtifactContent, runIndex: number, artifactIndex: number): ArtifactContentRenderer | undefined {
        const messageString: sarif.MultiformatMessageString | undefined = RenderingArtifactContentRenderer.tryGetMessageStringFrom(artifactContent);
        if (!messageString) {
            return undefined;
        }

        return new RenderingArtifactContentRenderer(artifactContent);
    }

    /**
     * @inheritdoc
     */
    public render(artifactUri: vscode.Uri): string {
        return this.renderedContent.markdown ? this.renderedContent.markdown : this.renderedContent.text;
    }
}
