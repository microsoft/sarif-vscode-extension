/*!
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 */

import { CancellationToken, CodeLens, CodeLensProvider, Disposable, Event, EventEmitter, languages, ProviderResult, TextDocument } from "vscode";
import { ExplorerController } from "./ExplorerController";
import { CodeFlow, ThreadFlow, CodeFlowStep, Location, SarifViewerDiagnostic } from "./common/Interfaces";

/**
 * This class handles providing the CodeFlow step codelenses for the current diagnostic
 */
export class CodeFlowCodeLensProvider implements CodeLensProvider, Disposable {
    private disposables: Disposable[]  = [];
    private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();

    public constructor(private readonly explorerController: ExplorerController) {
        this.disposables.push(this.onDidChangeCodeLensesEmitter);
        this.disposables.push(languages.registerCodeLensProvider("*", this));
        this.disposables.push(explorerController.onDidChangeVerbosity(this.onDidChangeVerbosity.bind(this)));
        this.disposables.push(explorerController.onDidChangeActiveDiagnostic(this.onDidChangeActiveDiagnostic.bind(this)));
    }

    /**
     * For disposing on extension close
     */
    public dispose(): void {
        Disposable.from(...this.disposables).dispose();
        this.disposables = [];
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

        if (!this.explorerController.activeDiagnostic) {
            return [];
        }

        const codeLenses: CodeLens[] = [];
        const verbosity: string = this.explorerController.selectedVerbosity || "important";
        const codeFlows: CodeFlow[] = this.explorerController.activeDiagnostic.resultInfo.codeFlows;
        for (const cFIndex of codeFlows.keys()) {
            const codeFlow: CodeFlow = codeFlows[cFIndex];
            for (const tFIndex of codeFlow.threads.keys()) {
                const threadFlow: ThreadFlow = codeFlow.threads[tFIndex];
                for (const stepIndex of threadFlow.steps.keys()) {
                    const step: CodeFlowStep = threadFlow.steps[stepIndex];
                    const stepLoc: Location | undefined = step.location;
                    if (stepLoc && stepLoc.uri && stepLoc.range && stepLoc.uri.toString() === document.uri.toString()) {
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

        return codeLenses;
    }

    /**
     * Use to trigger a refresh of the CodeFlow CodeLenses
     */
    private onDidChangeVerbosity(verbosity: string | undefined): void {
        this.onDidChangeCodeLensesEmitter.fire();
    }

    /**
     * Use to trigger a refresh of the CodeFlow CodeLenses
     */
    public onDidChangeActiveDiagnostic(diagnostic: SarifViewerDiagnostic | undefined): void {
        this.onDidChangeCodeLensesEmitter.fire();
    }
}
