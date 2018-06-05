// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import * as sarif from "sarif";
import {
    CancellationToken, CodeLens, CodeLensProvider, Disposable, Event, EventEmitter, languages, ProviderResult,
    TextDocument,
} from "vscode";
import { ExplorerContentProvider } from "./ExplorerContentProvider";

/**
 * This class handles providing the CodeFlow step codelenses for the current diagnostic
 */
export class CodeFlowCodeLensProvider implements CodeLensProvider {
    private static instance: CodeFlowCodeLensProvider;

    private codeLensProvider: Disposable;
    private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();

    private constructor() {
        this.codeLensProvider = languages.registerCodeLensProvider("*", this);
    }

    static get Instance(): CodeFlowCodeLensProvider {
        if (CodeFlowCodeLensProvider.instance === undefined) {
            CodeFlowCodeLensProvider.instance = new CodeFlowCodeLensProvider();
        }

        return CodeFlowCodeLensProvider.instance;
    }

    /**
     * For disposing on extension close
     */
    public dispose() {
        this.codeLensProvider.dispose();
    }

    public get onDidChangeCodeLenses(): Event<void> {
        return this.onDidChangeCodeLensesEmitter.event;
    }

    public provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]> {
        const codeLenses: CodeLens[] = [];
        const explorerCP = ExplorerContentProvider.Instance;
        const verbosity = explorerCP.codeFlowVerbosity || sarif.CodeFlowLocation.importance.important;

        if (explorerCP.activeSVDiagnostic !== undefined) {
            const codeFlows = explorerCP.activeSVDiagnostic.resultInfo.codeFlows;
            if (codeFlows !== undefined) {
                for (const cFIndex of codeFlows.keys()) {
                    const codeFlow = codeFlows[cFIndex];
                    for (const tFIndex of codeFlow.threads.keys()) {
                        const threadFlow = codeFlow.threads[tFIndex];
                        for (const stepIndex of threadFlow.steps.keys()) {
                            const step = threadFlow.steps[stepIndex];
                            if (step.location.uri.toString() === document.uri.toString()) {
                                if (step.importance === sarif.CodeFlowLocation.importance.essential ||
                                    verbosity === sarif.CodeFlowLocation.importance.unimportant ||
                                    step.importance === verbosity) {
                                    const codeLens = new CodeLens(step.location.range, step.codeLensCommand);
                                    codeLenses.push(codeLens);
                                }
                            }
                        }
                    }
                }
            }
        }

        return codeLenses;
    }

    /**
     * Use to trigger a refresh of the CodeFlow CodeLenses
     */
    public triggerCodeLensRefresh() {
        this.onDidChangeCodeLensesEmitter.fire();
    }
}
