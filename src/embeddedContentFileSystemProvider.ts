/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import * as vscode from "vscode";
import * as sarif from "sarif";
import * as fs from "fs";
import { JsonMapping, JsonMap } from "./common/interfaces";
import * as nls from 'vscode-nls';
import { BinaryContentRenderer } from "./binaryContentRenderer";
nls.config({locale: process.env.VSCODE_NLS_CONFIG});
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/**
 * Represents information parsed from the 'sarifEmbeddedContent' URI.
 * The URI is of the format 'sarifEmbeddedContent:///<originalFileNameAsBase64>/<vscodeFileName?/runs/<runIndex>/artifact/<artifactIndex>#<sarifLogFileAsBase64>
 */
interface ParsedUriData {
    readonly log: vscode.Uri;
    readonly originalFileName: string;
    readonly vscodeFileName: string;
    readonly runIndex: number;
    readonly artifactIndex: number;
}

export class EmbeddedContentFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
    private static EmbeddedContentScheme: string = 'sarifEmbeddedContent';
    private disposables: vscode.Disposable[] = [];
    private readonly onDidChangeFileEventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]> = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private static indicesRegex: RegExp = new RegExp(/\/runs\/(\d+)\/artifacts\/(\d+)\//);
    private static expectedMatchLength: number = 3;
    private static indexOfRunInMatch: number = 1;
    private static indexOfArtifactInMatch: number = 2;

    private static binaryDataMarkdownHeader: string = localize("embeddedContent.tableHeader", "|Offset|0|1|2|3|4|5|6|7|\r\n|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|");

    private static parseUri(uri: vscode.Uri): ParsedUriData {
        if (!uri.scheme.invariantEqual(EmbeddedContentFileSystemProvider.EmbeddedContentScheme)) {
            throw new Error('Incorrect scheme');
        }

        const matchArray: RegExpExecArray | null = EmbeddedContentFileSystemProvider.indicesRegex.exec(uri.query);
        if (!matchArray || matchArray.length !== EmbeddedContentFileSystemProvider.expectedMatchLength) {
            throw new Error('Incorrect scheme');
        }

        const fsPathSplit: string[] = uri.path.split('/').filter((pathPart) => pathPart.length !== 0) ;
        if (fsPathSplit.length !== 2) {
            throw new Error('The path of the embedded content URI is expected to have 2 path portions. One for the original file name, and the one presented to VSCode.')
        }

        const logUriAsString: string = Buffer.from(uri.fragment, 'base64').toString('UTF8');
        const originalFileNameAsString: string = Buffer.from(fsPathSplit[0], 'base64').toString('UTF8');
        return {
            log: vscode.Uri.parse(logUriAsString, /*strict*/ true),
            runIndex: Number.parseInt(matchArray[EmbeddedContentFileSystemProvider.indexOfRunInMatch], 10),
            artifactIndex: Number.parseInt(matchArray[EmbeddedContentFileSystemProvider.indexOfArtifactInMatch], 10),
            originalFileName: originalFileNameAsString,
            vscodeFileName: fsPathSplit[1]
        };
    }

    private static async readLog(embeddedContentUri: vscode.Uri): Promise<sarif.Log> {
        const parseData: ParsedUriData = EmbeddedContentFileSystemProvider.parseUri(embeddedContentUri);
        let docMapping: JsonMapping;
        const jsonBuffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
            fs.readFile(parseData.log.fsPath, (err, data) => {
                err ? reject(err) : resolve(data);
            });
        });
        const jsonMap: JsonMap = require('json-source-map');
        docMapping = jsonMap.parse(jsonBuffer.toString());
        return docMapping.data;
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
        const parsedUriData: ParsedUriData = EmbeddedContentFileSystemProvider.parseUri(uri);
        const log: sarif.Log = await EmbeddedContentFileSystemProvider.readLog(uri);
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

        if (!artifact.location) {
            throw new Error(`There is no location associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        if (!artifact.contents) {
            throw new Error(`There is no contents associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        if (!artifact.contents.text && !artifact.contents.binary && !artifact.contents.rendered) {
            throw new Error(`There is no contents associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        let contentSize: number = 0;
        if (artifact.contents.text) {
            contentSize = artifact.contents.text.length;
        } else if (artifact.contents.binary) {
            contentSize = artifact.contents.binary.length;
        } else if (artifact.contents.rendered) {
            if (artifact.contents.rendered.markdown) {
                contentSize = artifact.contents.rendered.markdown.length;
            } else if (artifact.contents.rendered.text) {
                contentSize = artifact.contents.rendered.text.length;
            }
        }

        const time: number = artifact.lastModifiedTimeUtc !== undefined ? Date.parse(artifact.lastModifiedTimeUtc) : Date.now();
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
    public createDirectory(uri: vscode.Uri): void {
        throw new Error('Not implemented');
    }

    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const parsedUriData: ParsedUriData = EmbeddedContentFileSystemProvider.parseUri(uri);
        const log: sarif.Log = await EmbeddedContentFileSystemProvider.readLog(uri);
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

        if (!artifact.location) {
            throw new Error(`There is no location associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        if (!artifact.contents) {
            throw new Error(`There is no contents associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        if (!artifact.contents.text && !artifact.contents.binary && !artifact.contents.rendered) {
            throw new Error(`There is no contents associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex} does not exist.`);
        }

        if (artifact.contents.text) {
            return new Buffer(artifact.contents.text, artifact.encoding);
        }

        if (artifact.contents.binary) {
            const binaryContentRenderer: BinaryContentRenderer = new BinaryContentRenderer(artifact.contents.binary);
            return Buffer.from(binaryContentRenderer.renderAsMarkdown(parsedUriData.originalFileName), 'utf8');
        }

        if (artifact.contents.rendered) {
            if (artifact.contents.rendered.markdown) {
                return Buffer.from(artifact.contents.rendered.markdown, artifact.encoding);
            }

            if (artifact.contents.rendered.text) {
                return Buffer.from(artifact.contents.rendered.text, artifact.encoding);
            }
        }

        throw new Error(`There is no contents that can be rendered associated with artifact index ${parsedUriData.runIndex} for run index ${parsedUriData.runIndex}.`);
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
     * @param fileName The file name that VSCode will display in the editor and use for detection of type.
     * @param runIndex The index of the run in the SARIF file.
     * @param artifactIndex The artifact index.
     */
    public static tryCreateUri(sarifLog: sarif.Log, logPath: vscode.Uri, fileName: string, runIndex: number, artifactIndex: number): vscode.Uri | undefined {
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

        // We render binary contents as markdown.
        // Add the ".md" extension for VSCode to detect that.
        const uriFileName: string = artifact.contents.binary ? `${fileName}.md` : fileName;
        const originalFileNameAsBase64: string = new Buffer(fileName).toString('base64');
        const logPathAsBase64: string = new Buffer(logPath.toString(/*skipEncoding*/ true), 'UTF8').toString('base64');
        return vscode.Uri.parse(`${EmbeddedContentFileSystemProvider.EmbeddedContentScheme}:///${originalFileNameAsBase64}/${uriFileName}?/runs/${runIndex}/artifacts/${artifactIndex}/#${logPathAsBase64}`, /*strict*/ true);
    }

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
 }
