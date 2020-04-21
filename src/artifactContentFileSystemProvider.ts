/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
import * as sarif from "sarif";
import * as fs from "fs";
import * as path from "path";
import { LogReader } from "./logReader";
import { ArtifactContentRenderer, tryCreateRendererForArtifactContent } from "./artifactContentRenderers/artifactContentRenderer";

/**
 * The purpose of this class is to provide a "file system provider" to artifact objects
 * which have a "contents" property set ultimate results user display.
 * Starting from the spec
 * https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html
 * An artifact can have "contents" property:
 * https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html#_Toc34317619
 * The artifact contents object can have many different types of rendering.
 * https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html#_Toc34317422
 * This file system provider allows the viewer to hand URIs to VSCode which it will
 * later "read" for display in the editor.
 * Using this technique allows us to virtualize access to the contents in the SARIF log
 * without the necessity of writing files to the file-system.
 */

/**
 * Represents information parsed from the 'sarifEmbeddedContent' URI.
 * Returned from  @see EmbeddedContentFileSystemProvider.parseUri
 */
interface ParsedUriData {
    /**
     * The SARIF log the URI was created from.
     */
    readonly log: vscode.Uri;

    /**
     * The original file name specified in the location object of the SARIF.
     */
    readonly artifactUri: vscode.Uri;

    /**
     * The run index in the SARIF log.
     */
    readonly runIndex: number;

    /**
     * The artifact index in the SARIF log (relative to the run).
     */
    readonly artifactIndex: number;
}

/**
 * Represents information parsed from the 'sarifEmbeddedContent' URI.
 * Used to encode and decode URI information in  @see EmbeddedContentFileSystemProvider.parseUri
 * and @see EmbeddedContentFileSystemProvider.tryCreateUri
 */
interface EncodedUriData {
    /**
     * The SARIF log the URI was created from.
     */
    readonly log: string;

    /**
     * The original file name specified in the location object of the SARIF.
     */
    readonly artifactUri: string;

    /**
     * The run index in the SARIF log.
     */
    readonly runIndex: number;

    /**
     * The artifact index in the SARIF log (relative to the run).
     */
    readonly artifactIndex: number;
}

/**
 * Use to return the artifact contents and the data parsed from the embedded artifact URI.
 * @see EmbeddedContentFileSystemProvider.getArtifactInformationFromUri
 */
interface ArtifactInformationFromUri {
    /**
     * The artifact.
     */
    artifact: sarif.Artifact;

    /**
     * The artifact contents.
     */
    contents: sarif.ArtifactContent;

    /**
     * The information parsed from the embedded URI.
     */
    parsedUriData: ParsedUriData;

    /**
     * The SARIF log file.
     */
    log: sarif.Log;
}

/**
 * A file system provider that handles embedded content.
 */
export class ArtifactContentFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    // The URI scheme for the content.
    private static ArtifactContentScheme: string = 'sarifArtifactContent';

    private readonly onDidChangeFileEventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    /**
     * Creates in instance of the embedded content file system provider.
     */
    public constructor() {
        this.disposables.push(this.onDidChangeFileEventEmitter);
        this.disposables.push(vscode.workspace.registerFileSystemProvider(ArtifactContentFileSystemProvider.ArtifactContentScheme, this, {
            isCaseSensitive: true,
            isReadonly: true
        }));
    }

    /**
     * @inheritdoc
     */
    public get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
        return this.onDidChangeFileEventEmitter.event;
    }

    /**
     * @inheritdoc
     */
    public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        const parsedUriData: ParsedUriData = ArtifactContentFileSystemProvider.parseUri(uri);

        const watcher: (currentStats: fs.Stats, previousStats: fs.Stats) => void = (currentStats, previousStats) => {
            this.onDidChangeFileEventEmitter.fire([
                {
                    type: vscode.FileChangeType.Changed,
                    uri: parsedUriData.log
                }
            ]);
        };

        fs.watchFile(parsedUriData.log.fsPath, watcher);

        return {
            dispose: () => { fs.unwatchFile(parsedUriData.log.fsPath, watcher); }
        };
    }

    /**
     * @inheritdoc
     */
    public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const artifactContent: ArtifactInformationFromUri = await ArtifactContentFileSystemProvider.getArtifactInformationFromUri(uri);
        const time: number = artifactContent.artifact.lastModifiedTimeUtc !== undefined ? Date.parse(artifactContent.artifact.lastModifiedTimeUtc) : Date.now();
        return {
            type: vscode.FileType.File,
            ctime: time,
            mtime: time,
            size: 0
        };
    }

    /**
     * @inheritdoc
     */
    // Disabling lint rule due to VSCode type.
    // tslint:disable-next-line: array-type
    public readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        return [];
    }

    /**
     * @inheritdoc
     */
    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const artifactContent: ArtifactInformationFromUri = await ArtifactContentFileSystemProvider.getArtifactInformationFromUri(uri);
        const artifactContentRenderer: ArtifactContentRenderer | undefined = tryCreateRendererForArtifactContent(artifactContent.log, artifactContent.contents);

        if (artifactContentRenderer) {
            return Buffer.from(artifactContentRenderer.render(artifactContent.parsedUriData.artifactUri));
        }

        throw new Error(`There is no contents that can be rendered associated with artifact index ${artifactContent.parsedUriData.runIndex} for run index ${artifactContent.parsedUriData.runIndex}.`);
    }

    /**
     * @inheritdoc
     */
    public createDirectory(uri: vscode.Uri): void {
        throw new Error('Not implemented');
    }

    /**
     * @inheritdoc
     */
    public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
        throw new Error('Not implemented');
    }

    /**
     * @inheritdoc
     */
    public delete(uri: vscode.Uri, options: { recursive: boolean }): void {
        throw new Error('Not implemented');
    }

    /**
     * @inheritdoc
     */
    public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        throw new Error('Not implemented');
    }

    /**
     * @inheritdoc
     */
    public dispose(): void {
        vscode.Disposable.from(...this.disposables).dispose();
        this.disposables = [];
    }

    /**
     * Creates an embedded content URI.
     * @param sarifLog The raw sarif log.
     * @param logPath The full path to the SARIF log file.
     * @param artifactUri The file name that VSCode will display in the editor and use for detection of type.
     * @param runIndex The index of the run in the SARIF file.
     * @param artifactIndex The artifact index.
     * @param requiredExtension Indicates how to render binary content.
     */
    public static tryCreateUri(sarifLog: sarif.Log, logPath: vscode.Uri, artifactUri: vscode.Uri, runIndex: number, artifactIndex: number, requiredExtension: string | undefined): vscode.Uri | undefined {
        if (!logPath.isSarifFile()) {
            throw new Error(`${logPath.toString()} is not a SARIF file`);
        }

        const run: sarif.Run | undefined = sarifLog.runs[runIndex];
        if (!run || !run.artifacts) {
            return undefined;
        }
        const artifact: sarif.Artifact | undefined = run.artifacts[artifactIndex];
        if (!artifact || !artifact.contents) {
            return undefined;
        }

        // Modify the URI path to contain an extension that VSCode will use to detect it's file type
        // which it then uses for rendering.
        let uriPath: string;
        if (!requiredExtension) {
            uriPath = artifactUri.path;
        } else {
            const vscodeUri: vscode.Uri = artifactUri.with({ path: artifactUri.path.concat(requiredExtension) });
            uriPath = path.posix.join(artifactUri.path, vscodeUri.path);
        }

        const encodedUriData: EncodedUriData = {
            artifactIndex,
            runIndex,
            log: logPath.toString(/*skipEncoding*/ true),
            artifactUri: artifactUri.toString(/*skpEncoding*/ true)
        };

        const encodedUriDataAsBase64: string = new Buffer(JSON.stringify(encodedUriData)).toString('base64');

        return vscode.Uri.parse(`${ArtifactContentFileSystemProvider.ArtifactContentScheme}://${uriPath}?${encodedUriDataAsBase64}`, /*strict*/ true);
    }

    private static parseUri(uri: vscode.Uri): ParsedUriData {
        if (!uri.scheme.invariantEqual(ArtifactContentFileSystemProvider.ArtifactContentScheme)) {
            throw new Error('Incorrect scheme');
        }

        const encodedUriData: EncodedUriData = JSON.parse(Buffer.from(uri.query, 'base64').toString());

        return {
            log: vscode.Uri.parse(encodedUriData.log, /*strict*/ true),
            runIndex: encodedUriData.runIndex,
            artifactIndex: encodedUriData.artifactIndex,
            artifactUri: vscode.Uri.parse(encodedUriData.artifactUri, /*strict*/ true)
        };
    }

    /**
     * Retrieves the SARIF artifact contents object from a embedded content URI.
     * @param uri The URI to retrieve the content from.
     */
    private static async getArtifactInformationFromUri(uri: vscode.Uri): Promise<ArtifactInformationFromUri> {
        const parsedUriData: ParsedUriData = ArtifactContentFileSystemProvider.parseUri(uri);
        const log: sarif.Log = (await LogReader.readLogJsonMapping(parsedUriData.log)).data;
        const run: sarif.Run | undefined = log.runs[parsedUriData.runIndex];
        if (!run) {
            throw new Error('Cannot find run in log.');
        }

        if (!run.artifacts) {
            throw new Error(`There are no artifacts for ${parsedUriData.runIndex}.`);
        }

        const artifact: sarif.Artifact = run.artifacts[parsedUriData.artifactIndex];
        if (!artifact) {
            throw new Error(`Artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        if (!artifact.contents) {
            throw new Error(`There is no contents associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        return { artifact, parsedUriData, log, contents: artifact.contents };
    }
 }
