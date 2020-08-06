// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { computed, IArrayWillSplice, intercept, observable } from 'mobx';
import { Log, Result } from 'sarif';
import { Memento } from 'vscode';
import { mapDistinct } from '../shared';
import '../shared/extension';

export class Store {
    static globalState: Memento

    @observable.shallow logs = [] as Log[]
    @computed get results() {
        const runs = this.logs.map(log => log.runs).flat();
        return runs.map(run => run.results).filter(run => run).flat() as Result[];
    }
    @computed get distinctArtifactNames() {
        const fileAndUris = this.logs.map(log => [...log._distinct.entries()]).flat();
        return mapDistinct(fileAndUris);
    }

    constructor() {
        intercept(this.logs, objChange => {
            const change = objChange as unknown as IArrayWillSplice<Log>;
            change.added = change.added.filter(log => this.logs.every(existing => existing._uri !== log._uri));
            return objChange;
        });
    }
}
