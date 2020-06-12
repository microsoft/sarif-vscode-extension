// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { observable } from 'mobx';
import { observer } from 'mobx-react';
import * as React from 'react';
import { Component } from 'react';
import { Visibility } from '../shared';
import './detailsFeedback.scss';
import { Checkrow } from './widgets';

@observer export class DetailsFeedback extends Component {
    @observable feedbackTags: Record<string, Visibility> = {
        'Useful (#useful)': undefined,
        'False (#falsepositive)': undefined,
        'Not Actionable (#notactionable)': undefined,
        'Low Value (#lowvalue)': undefined,
        'Code Does Not Ship (#doesnotship)': undefined,
        '3rd Party/OSS Code (#3rdpartycode)': undefined,
        'Feature Request (#featurerequest)': undefined,
        'Other (#other)': undefined,
    }
    render() {
        const {feedbackTags} = this;
        return <div className="svDetailsFeedback">
            <div className="svFeedbackColumns">
                <div className="svDetailsSection">
                    <div className="svDetailsTitle">Feedback Tags</div>
                    <div>{/* rename class */}
                        {Object.keys(feedbackTags).map(name => <Checkrow key={name} label={name} state={feedbackTags} />)}
                    </div>
                </div>
                <div className="svDetailsSection">
                    <div className="svDetailsTitle">More Details</div>
                    <textarea placeholder={'Give Detailed Feedback Here...'}>
                    </textarea>
                    <Checkrow label={'I need help NOW'}
                        description={'I need urgent support from the checker owner.'}
                        state={{ 'I need help NOW': undefined }} />
                    <Checkrow label={'Tented Code'}
                        description={'Do not upload my source file to the static analysis team.'}
                        state={{ 'Tented Code': undefined }} />
                    <Checkrow label={'Send Full Dataset'}
                        description={'Uncheck if you don\'t want to upload extra diagnostic data to the checker owner.'}
                        state={{ 'Tented Code': undefined }} />
                    <input type="button" value={'Submit Feedback'}></input>
                </div>
            </div>
        </div>;
    }
}
