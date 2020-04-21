/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
import * as sarif from "sarif";
import { BinaryArtifactContentRenderer } from "./binaryArtifactContentRenderer";
import { TextArtifactContentRenderer } from "./textArtifactContentRenderer";
import { RenderingArtifactContentRenderer } from "./renderingArtifactContentRenderer";

/**
 * Interface exposed from artifact content renders.
 */
export interface ArtifactContentRenderer {
    /**
     * Renders the contents.
     * @param artifactUri The artifact URI to use as the file-name in the markdown.
     */
    render(artifactUri: vscode.Uri): string;

    /**
     * Computes a range from the content it will render.
     * @param region The region for the artifact content.
     */
    rangeFromRegion?(region: sarif.Region): vscode.Range | undefined;

    /**
     * Specifies a specific file extension needed for VSCode to detect the
     * document type. For example, makrdown => '.md'. The extension
     * should include any necessary periods.
     */
    specificUriExtension?: string;
}

type TryCreateLogFile = (log: sarif.Log, artifactContent: sarif.ArtifactContent, runIndex: number, artifactIndex: number) => ArtifactContentRenderer | undefined;

const rendererCreators: TryCreateLogFile[] = [
    TextArtifactContentRenderer.tryCreateFromLog,
    BinaryArtifactContentRenderer.tryCreateFromLog,
    RenderingArtifactContentRenderer.tryCreateFromLog
];

/**
 * Attempts to create the appropriate renderer for the given artifact content object.
 * @param log The SARIF log that contains information about the artifact content.
 * @param artifactContent The artifact content object.
 * @param runIndex The run index the artifact content object belongs to.
 * @param artifactIndex The artifact index.
 */
export function tryCreateRendererForArtifactContent(log: sarif.Log, artifactContent: sarif.ArtifactContent, runIndex: number, artifactIndex: number): ArtifactContentRenderer | undefined {
    for (const rendererCreator of rendererCreators) {
        const newRenderer: ArtifactContentRenderer | undefined = rendererCreator(log, artifactContent, runIndex, artifactIndex);
        if (newRenderer) {
            return newRenderer;
        }
    }

    return undefined;
}
