/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * --------------------------------------------------------------------------------------------*/

interface JwtToken {

    /**
     * Email address of the user. For us this is important because it will be alias@microsoft.com instead of name.last@microsoft.com.
     */
    upn: string;
}

const numJwtChunks = 3;

/**
 * Extract the user's email from the encoded data within the access token.
 * @param {string} token The JWT token.
 * @return {string} user email alias@microsot.com
 */
export function getUserEmailFromJwt(token?: string): string | undefined {
    if (!token) {
        return undefined;
    }

    const jwtParts: string[] = token.split('.');

    // JWT tokens have exactly three parts, the header, payload, and signature.
    // If the given token doesn't have three parts, there is an issue, so return null.
    if (jwtParts.length !== numJwtChunks) {
        return undefined;
    }

    try {
        // Decode the payload from base64.
        const decode = Buffer.from(token.split('.')[1], 'base64').toString();

        // Grab the upn value.
        const jwtJson: JwtToken = JSON.parse(decode) as JwtToken;
        return jwtJson.upn;
    } catch {
        return undefined;
    }
}
