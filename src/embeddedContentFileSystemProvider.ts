/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
import * as sarif from "sarif";
import * as fs from "fs";
import * as path from "path";
import { BinaryContentRenderer } from "./binaryContentRenderer";
import { LogReader } from "./logReader";

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
export class EmbeddedContentFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    // The URI scheme for the content.
    private static EmbeddedContentScheme: string = 'sarifEmbeddedContent';

    private readonly onDidChangeFileEventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    /**
     * Creates in instance of the embedded content file system provider.
     */
    public constructor() {
        this.disposables.push(this.onDidChangeFileEventEmitter);
        this.disposables.push(vscode.workspace.registerFileSystemProvider(EmbeddedContentFileSystemProvider.EmbeddedContentScheme, this, {
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
        const parsedUriData: ParsedUriData = EmbeddedContentFileSystemProvider.parseUri(uri);

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
        const artifactContent: ArtifactInformationFromUri = await EmbeddedContentFileSystemProvider.getArtifactInformationFromUri(uri);

        let contentSize: number = 0;
        if (artifactContent.contents.text) {
            contentSize = artifactContent.contents.text.length;
        } else if (artifactContent.contents.binary) {
            // This isn't exactly correct as we render it as markdown.
            // We could make it correct by calling render on the binary renderer
            // and computing the length. Turns out VSCode doesn't really use this
            // size, so.... this is good enough.
            contentSize = artifactContent.contents.binary.length;
        } else if (artifactContent.contents.rendered) {
            if (artifactContent.contents.rendered.markdown) {
                contentSize = artifactContent.contents.rendered.markdown.length;
            } else if (artifactContent.contents.rendered.text) {
                contentSize = artifactContent.contents.rendered.text.length;
            }
        }

        const time: number = artifactContent.artifact.lastModifiedTimeUtc !== undefined ? Date.parse(artifactContent.artifact.lastModifiedTimeUtc) : Date.now();
        return {
            type: vscode.FileType.File,
            ctime: time,
            mtime: time,
            size: contentSize
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
        const artifactContent: ArtifactInformationFromUri = await EmbeddedContentFileSystemProvider.getArtifactInformationFromUri(uri);
        if (artifactContent.contents.text) {
            return new Buffer(artifactContent.contents.text, artifactContent.artifact.encoding);
        }

        if (artifactContent.contents.binary) {
            const binaryContentRenderer: BinaryContentRenderer | undefined = BinaryContentRenderer.tryCreateFromLog(artifactContent.log, artifactContent.parsedUriData.runIndex, artifactContent.parsedUriData.artifactIndex);
            if (binaryContentRenderer) {
                return Buffer.from(binaryContentRenderer.renderAsMarkdown(artifactContent.parsedUriData.artifactUri));
            }
        }

        if (artifactContent.contents.rendered) {
            if (artifactContent.contents.rendered.markdown) {
                return Buffer.from(artifactContent.contents.rendered.markdown, artifactContent.artifact.encoding);
            }

            if (artifactContent.contents.text) {
                return Buffer.from(artifactContent.contents.rendered.text, artifactContent.artifact.encoding);
            }
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
     */
    public static tryCreateUri(sarifLog: sarif.Log, logPath: vscode.Uri, artifactUri: vscode.Uri, runIndex: number, artifactIndex: number): vscode.Uri | undefined {
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

        // We render binary and markdown content as markdown, so
        // we add the ".md" extension for VSCode to detect that.
        const vscodeUri: vscode.Uri = (artifact.contents.binary || artifact.contents.rendered?.markdown) ? artifactUri.with({ path: artifactUri.path.concat('.md') }) : artifactUri;
        const encodedUriData: EncodedUriData = {
            artifactIndex,
            runIndex,
            log: logPath.toString(/*skipEncoding*/ true),
            artifactUri: artifactUri.toString(/*skpEncoding*/ true)
        };

        const encodedUriDataAsBase64: string = new Buffer(JSON.stringify(encodedUriData)).toString('base64');
        const uriPath: string = path.posix.join(artifactUri.path, vscodeUri.path);

        return vscode.Uri.parse(`${EmbeddedContentFileSystemProvider.EmbeddedContentScheme}://${uriPath}?${encodedUriDataAsBase64}`, /*strict*/ true);
    }

    private static parseUri(uri: vscode.Uri): ParsedUriData {
        if (!uri.scheme.invariantEqual(EmbeddedContentFileSystemProvider.EmbeddedContentScheme)) {
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
        const parsedUriData: ParsedUriData = EmbeddedContentFileSystemProvider.parseUri(uri);
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
