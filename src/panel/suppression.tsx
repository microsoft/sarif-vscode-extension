// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable indent */ // Allowing for some custom intent under svDetailsGrid 2D layout.

import React, { useState } from 'react';
import { Suppression } from 'sarif';
import LocationComponent from './location';
import './suppression.scss';

interface SuppressionComponentProps {
    suppression: Suppression;
    onSubmit: (updatedSuppression: Suppression) => void;
    onCancel?: () => void;
    onRemove?: () => void;
    isNew?: boolean;
}

const SuppressionComponent: React.FC<SuppressionComponentProps> = ({ suppression, onSubmit, isNew = false, onCancel, onRemove }) => {
    const [isEditing, setIsEditing] = useState(isNew);
    const [editedSuppression, setEditedSuppression] = useState<Suppression>(suppression);

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setEditedSuppression(prev => ({ ...prev, [name]: value }));

        if (e.target.tagName.toLowerCase() === 'textarea') {
            adjustTextareaHeight(e as React.ChangeEvent<HTMLTextAreaElement>);
        }
    };

    const adjustTextareaHeight = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        e.target.style.height = '24px';
        e.target.style.height = `${Math.max(24, e.target.scrollHeight)}px`;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(editedSuppression);
        setIsEditing(false);
    };

    // todo: render the location like href in details
    return (
        <div className="suppressionComponent">
            {!isEditing ? (
                <div>
                    <p><strong>Kind:</strong> {suppression.kind}</p>
                    <p><strong>Status:</strong> {suppression.status}</p>
                    <p><strong>Justification:</strong> {suppression.justification}</p>
                    <p><strong>GUID:</strong> {suppression.guid}</p>
                    <span><LocationComponent location={suppression.location} /></span>
                    <button onClick={() => setIsEditing(true)}>edit</button>
                    <button onClick={onRemove}>remove</button>
                </div>
            ) : (
                <div className="suppressionForm">
                <form onSubmit={handleSubmit}>
                    <p><strong>Kind:</strong> {suppression.kind}</p>
                    <label>
                        Status:
                        <select
                            name="status"
                            value={editedSuppression.status}
                            onChange={handleChange}
                        >
                            <option value="accepted">Accepted</option>
                            <option value="underReview">Under Review</option>
                            <option value="rejected">Rejected</option>
                        </select>
                    </label>
                    <label>
                        Justification:
                        <textarea
                            name="justification"
                            value={editedSuppression.justification || ''}
                            onChange={handleChange}
                            onInput={adjustTextareaHeight}
                            />
                    </label>
                    <p><strong>GUID:</strong> {suppression.guid}</p>
                    <span><LocationComponent location={suppression.location} /></span>
                    <button type="submit">{isNew ? 'Add' : 'Update'}</button>
                    {!isNew && <button type="button" onClick={() => setIsEditing(false)}>Cancel</button>}
                    {isNew && <button type="button" onClick={onCancel}>Cancel</button>}
                </form>
            </div>
            )}
        </div>
    );
};

export default SuppressionComponent;
