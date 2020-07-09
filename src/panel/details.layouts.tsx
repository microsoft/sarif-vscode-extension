// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { observable } from 'mobx';
import * as React from 'react';
import { Component } from 'react';
import { Result } from 'sarif';
import { Details } from './details';

// A development tool to see `Details` in multiple layout states at once.
export class DetailsLayouts extends Component {
    render() {
        const result: Result = {
            ruleId: 'DEMO01',
            message: { text: 'A result' },
            stacks: [],
            _log: { _uri: 'file:///demo.sarif' },
            _message: 'A result',
            _run: {},
        } as unknown as Result;

        return <div className="svDetailsLayouts">
            <Details result={result} height={observable.box(300)} />
            <Details result={result} height={observable.box(600)} />
            <Details result={result} height={observable.box(300)} />
            <Details result={result} height={observable.box(600)} />
        </div>;
    }
}
