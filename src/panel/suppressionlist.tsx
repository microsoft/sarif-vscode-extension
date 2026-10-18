// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable indent */ // Allowing for some custom intent under svDetailsGrid 2D layout.


import React, { useState, useEffect } from 'react';
import { Suppression } from 'sarif';
import SuppressionComponent from './suppression';
import { ResultId } from '../shared/index';
import './suppression.scss';

interface SuppressionListComponentProps {
    initial_suppressions: Suppression[];
    result_id: ResultId;
}

const SuppressionListComponent: React.FC<SuppressionListComponentProps> = ({ initial_suppressions, result_id }) => {
    const [suppressions, setSuppressions] = useState<Suppression[]>(initial_suppressions);
    const [newSuppression, setNewSuppression] = useState<Suppression | null>(null);

    // Add useEffect to sync suppressions when initial_suppressions changes
    useEffect(() => {
        setSuppressions(initial_suppressions);
    }, [initial_suppressions]);

    const handleAddNewSuppression = () => {
        const emptySuppression: Suppression = {
            kind: 'external',
            status: 'underReview',
            guid: '',
            justification: ''
        };
        setNewSuppression(emptySuppression);
    };

    const handleCancelNewSuppression = () => {
        setNewSuppression(null);
    };

    const handleRemoveExistingSuppression = async (index: number) => {
        const updatedSuppressions = suppressions.filter((_, i) => i !== index);
        setSuppressions(updatedSuppressions);

        await vscode.postMessage({
            command: 'updateSuppressionFile',
            result_id,
            updated_suppressions: updatedSuppressions,
        });
    };

    const handleSuppressionSubmit = async (index: number | null, updatedSuppression: Suppression) => {
        let newSuppressions: Suppression[];
        if (index === null) {
            // New suppression
            newSuppressions = [...suppressions, updatedSuppression];
        } else {
            // Update existing suppression
            newSuppressions = suppressions.map((sup, i) =>
                i === index ? updatedSuppression : sup
            );
        }
        setSuppressions(newSuppressions);
        setNewSuppression(null);

        await vscode.postMessage({
            command: 'updateSuppressionFile',
            result_id,
            updated_suppressions: newSuppressions,
        });
    };

    return (
        <div className="suppressionListComponent">
            {suppressions.map((suppression, index) => (
                <SuppressionComponent
                    key={`${suppression.guid}-${index}`}
                    suppression={suppression}
                    onRemove={() => handleRemoveExistingSuppression(index)}
                    onSubmit={(updatedSuppression) => handleSuppressionSubmit(index, updatedSuppression)}
                />
            ))}
            {newSuppression && (
                <SuppressionComponent
                    suppression={newSuppression}
                    onSubmit={(updatedSuppression) => handleSuppressionSubmit(null, updatedSuppression)}
                    onCancel={handleCancelNewSuppression}
                    isNew={true}
                />
            )}
            {!newSuppression && (
                <button className="addSuppressionButton" onClick={handleAddNewSuppression}>
                    Add New Suppression
                </button>
            )}
        </div>
    );
};

export default SuppressionListComponent;
