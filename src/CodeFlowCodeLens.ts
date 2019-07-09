// /********************************************************
// *                                                       *
// *   Copyright (C) Microsoft. All rights reserved.       *
// *                                                       *
// ********************************************************/
import {
    CancellationToken, CodeLens, CodeLensProvider, Disposable, Event, EventEmitter, languages, ProviderResult,
    TextDocument,
} from "vscode";
import { ExplorerController } from "./ExplorerController";

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

    /**
     * Compute a list of [lenses](#CodeLens). This call should return as fast as possible and if
     * computing the commands is expensive implementors should only return code lens objects with the
     * range set and implement [resolve](#CodeLensProvider.resolveCodeLens).
     * @param document The document in which the command was invoked.
     * @param token A cancellation token.
     */
    public provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]> {
        const codeLenses: CodeLens[] = [];
        const explorerController = ExplorerController.Instance;
        const verbosity = explorerController.selectedVerbosity || "important";

        if (explorerController.activeSVDiagnostic !== undefined) {
            const codeFlows = explorerController.activeSVDiagnostic.resultInfo.codeFlows;
            if (codeFlows !== undefined) {
                for (const cFIndex of codeFlows.keys()) {
                    const codeFlow = codeFlows[cFIndex];
                    for (const tFIndex of codeFlow.threads.keys()) {
                        const threadFlow = codeFlow.threads[tFIndex];
                        for (const stepIndex of threadFlow.steps.keys()) {
                            const step = threadFlow.steps[stepIndex];
                            const stepLoc = step.location;
                            if (stepLoc.uri !== undefined) {
                                if (stepLoc.uri.toString() === document.uri.toString()) {
                                    if (step.importance === "essential" ||
                                        verbosity === "unimportant" ||
                                        step.importance === verbosity) {
                                        const codeLens = new CodeLens(stepLoc.range, step.codeLensCommand);
                                        codeLenses.push(codeLens);
                                    }
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
