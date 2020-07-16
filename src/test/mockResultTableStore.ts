// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Log } from 'sarif';

export const log = {
    version: '2.1.0',
    runs: [{
        tool: {
            driver: { name: 'Driver' }
        },
        results: [{
            message: {
                text: 'Message 1'
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_1.txt',
                    }
                }
            }]
        },{
            message: {
                text: 'Message 2'
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_2.txt',
                    }
                }
            }]
        }, {
            message: {
                text: 'Message 3'
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_2.txt',
                    }
                }
            }]
        },{
            message: {
                text: 'Message 4'
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_3.txt',
                    }
                }
            }]
        }, {
            message: {
                text: 'Message 5'
            },
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_3.txt',
                    }
                }
            }]
        }, {
            message: {
                text: 'Message 6'
            },
            level: 'none',
            baselineState: 'new',
            _suppression: 'not suppressed',
            locations: [{
                physicalLocation: {
                    artifactLocation: {
                        uri: '/folder/file_3.txt',
                    }
                }
            }]
        }]
    }]
} as Log;

export const filtersRow = {
    Level: {
        'Error': true,
        'Warning': true,
        'Note': true,
        'None': true,
    },
    Baseline: {
        'New': true,
        'Unchanged': true,
        'Updated': true,
        'Absent': false,
    },
    Suppression: {
        'Not Suppressed': true,
        'Suppressed': false,
    }
};

export const filtersColumn = {
    Columns: {
        'Baseline': false,
        'Suppression': false,
        'Rule': false,
    }
};
