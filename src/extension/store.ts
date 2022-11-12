// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computed, IArrayWillSplice, intercept, observable } from 'mobx';
import { Log } from 'sarif';
import { Memento } from 'vscode';
import { mapDistinct } from '../shared';
import '../shared/extension';
import { AnalysisInfosForCommit } from './index.activateGithubAnalyses';

export class Store {
    static globalState: Memento

    @observable banner = '';

    @observable.shallow logs = [] as Log[]
    @observable resultsFixed = [] as string[] // JSON string of ResultId. TODO: Migrate to set.
    @computed get results() {
        const runs = this.logs.map(log => log.runs).flat();
        return runs.map(run => run.results ?? []).flat()
            .filter(result => !this.resultsFixed.includes(JSON.stringify(result._id)));
    }
    @computed get distinctArtifactNames() {
        const fileAndUris = this.logs.map(log => [...log._distinct.entries()]).flat();
        return mapDistinct(fileAndUris);
    }

    public disableSelectionSync = false;
    public branch = ''
    public commitHash = ''
    @observable.shallow analysisInfo: AnalysisInfosForCommit | undefined
    @observable remoteAnalysisInfoUpdated = 0 // A version number as a substitute for a value-less observable.

    constructor() {
        intercept(this.logs, objChange => {
            const change = objChange as unknown as IArrayWillSplice<Log>;
            change.added = change.added.filter(log => this.logs.every(existing => existing._uri !== log._uri));
            return objChange;
        });
    }
}
