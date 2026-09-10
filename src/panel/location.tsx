// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable indent */ // Allowing for some custom intent under svDetailsGrid 2D layout.

import React, { useState } from 'react';
import { Location } from 'sarif';
import './suppression.scss';

interface LocationComponentProps {
    location: Location | undefined;
}

const LocationComponent: React.FC<LocationComponentProps> = ({ location }) => {
    return (<p><strong>Locations:</strong>
        {location && (
            <div>
                {location.physicalLocation && (
                    <div className="locationBlock">
                        <strong>Physical Location:</strong>
                        <div className="locationDetails">
                            <span>File: {location.physicalLocation.artifactLocation?.uri}</span>
                            <span>Start Line: {location.physicalLocation.region?.startLine}</span>
                            <span>End Line: {location.physicalLocation.region?.endLine || 'N/A'}</span>
                            <span>Snippet: {location.physicalLocation.region?.snippet?.text || 'N/A'}</span>
                        </div>
                    </div>
                )}
                {location.logicalLocations && (
                    location.logicalLocations.map((logicalLocation, index) => (
                        <p key={index}>
                            <div className="locationBlock">
                                <strong>Logical Location:</strong>
                                <div className="locationDetails">
                                    Name: {logicalLocation.fullyQualifiedName} <br />
                                    Kind: {logicalLocation.kind || 'N/A'} <br />
                                    Decorated Name: {logicalLocation.decoratedName || 'N/A'}
                                </div>
                            </div>
                        </p>
                    ))
                )}
            </div>
        )}
        </p>);
};

export default LocationComponent;