import { requestUrl } from 'obsidian';

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
}

export const CLIENT_ID = '28d3e5ae-00e3-4ff6-9443-742f353cf511'; 

export const REDIRECT_URI = 'obsidian://mstodo-auth'; 
export const TENANT = 'common';
export const SCOPES = ['Tasks.ReadWrite', 'User.Read', 'offline_access'];

export class AuthManager {
    // 生成随机字符串 (Verifier)
    generateCodeVerifier(): string {
        const array = new Uint8Array(32);
        window.crypto.getRandomValues(array);
        return this.base64UrlEncode(array);
    }

    // 生成挑战码 (Challenge)
    async generateCodeChallenge(verifier: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return this.base64UrlEncode(new Uint8Array(digest));
    }

    // Base64 URL 编码 (RFC 4648)
    private base64UrlEncode(array: Uint8Array): string {
        let str = '';
        const bytes = Array.from(array);
        for (const b of bytes) {
            str += String.fromCharCode(b);
        }
        return btoa(str)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    // 1. 获取登录 URL
    async getAuthUrl(verifier: string): Promise<string> {
        const challenge = await this.generateCodeChallenge(verifier);
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            response_type: 'code',
            redirect_uri: REDIRECT_URI,
            response_mode: 'query',
            scope: SCOPES.join(' '),
            code_challenge: challenge,
            code_challenge_method: 'S256'
        });
        return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params.toString()}`;
    }

    // 2. 用 Code 换取 Token
    async exchangeCodeForToken(code: string, verifier: string): Promise<TokenResponse> {
        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            scope: SCOPES.join(' '),
            code: code,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
            code_verifier: verifier
        });

        const response = await requestUrl({
            url: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
            method: 'POST',
            contentType: 'application/x-www-form-urlencoded',
            body: body.toString()
        });

        return response.json;
    }

    // 3. 刷新 Token (当 Access Token 过期时调用)
    async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            scope: SCOPES.join(' '),
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        });

        const response = await requestUrl({
            url: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
            method: 'POST',
            contentType: 'application/x-www-form-urlencoded',
            body: body.toString()
        });

        return response.json;
    }
}