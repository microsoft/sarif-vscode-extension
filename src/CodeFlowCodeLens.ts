/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import {
    CancellationToken, CodeLens, CodeLensProvider, Disposable, Event, EventEmitter, languages, ProviderResult,
    TextDocument,
} from "vscode";
import { ExplorerController } from "./ExplorerController";
import { CodeFlow, ThreadFlow, CodeFlowStep, Location } from "./common/Interfaces";

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
        if (!CodeFlowCodeLensProvider.instance) {
            CodeFlowCodeLensProvider.instance = new CodeFlowCodeLensProvider();
        }

        return CodeFlowCodeLensProvider.instance;
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        this.onDidChangeCodeLensesEmitter.dispose();
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
        const explorerController: ExplorerController = ExplorerController.Instance;
        const verbosity: string = explorerController.selectedVerbosity || "important";

        if (explorerController.activeSVDiagnostic) {
            const codeFlows: CodeFlow[] = explorerController.activeSVDiagnostic.resultInfo.codeFlows;
            if (codeFlows) {
                for (const cFIndex of codeFlows.keys()) {
                    const codeFlow: CodeFlow = codeFlows[cFIndex];
                    for (const tFIndex of codeFlow.threads.keys()) {
                        const threadFlow: ThreadFlow = codeFlow.threads[tFIndex];
                        for (const stepIndex of threadFlow.steps.keys()) {
                            const step: CodeFlowStep = threadFlow.steps[stepIndex];
                            const stepLoc: Location = step.location;
                            if (stepLoc.uri) {
                                if (stepLoc.uri.toString() === document.uri.toString()) {
                                    if (step.importance === "essential" ||
                                        verbosity === "unimportant" ||
                                        step.importance === verbosity) {
                                        const codeLens: CodeLens = new CodeLens(stepLoc.range, step.codeLensCommand);
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
    public triggerCodeLensRefresh(): void {
        this.onDidChangeCodeLensesEmitter.fire();
    }
}
