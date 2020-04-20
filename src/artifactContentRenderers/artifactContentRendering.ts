/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
import * as sarif from "sarif";
import { BinaryArtifactContentRenderer } from "./binaryArtifactContentRenderer";
import { TextArtifactContentRenderer } from "./textArtifactContentRenderer";
import { RenderingArtifactContentRenderer } from "./renderingArtifactContentRenderer";

export interface ArtifactContentRenderer {
    /**
     * Computes a range from the content it will render.
     * @param region The region for the artifact content.
     */
    rangeFromRegion?(region: sarif.Region): vscode.Range | undefined;

    render(artifactUri: vscode.Uri): string;

    specificUriExtension?: string;
}

type tryCreateLogFile = (log: sarif.Log, artifactContents: sarif.ArtifactContent, runIndex: number, artifactIndex: number) => ArtifactContentRenderer | undefined;

const rendererCreators: tryCreateLogFile[] = [
    TextArtifactContentRenderer.tryCreateFromLog,
    BinaryArtifactContentRenderer.tryCreateFromLog,
    RenderingArtifactContentRenderer.tryCreateFromLog
];

/**
 * Attempts to create the appropriate renderer for the given artifact content object.
 * @param log The SARIF log that contains information about the artifact content.
 * @param artifactContents The artifact content object.
 * @param runIndex The run index the artifact content object belongs to.
 * @param artifactIndex The artifact index.
 */
export function tryCreateRendererForArtifactContent(log: sarif.Log, artifactContents: sarif.ArtifactContent, runIndex: number, artifactIndex: number): ArtifactContentRenderer | undefined {
    for (const rendererCreator of rendererCreators) {
        const newRenderer: ArtifactContentRenderer | undefined = rendererCreator(log, artifactContents, runIndex, artifactIndex);
        if (newRenderer) {
            return newRenderer;
        }
    }

    return undefined;
}
