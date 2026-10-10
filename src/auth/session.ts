import { Notice, type SecretStorage } from 'obsidian';
import { AuthManager, type TokenResponse } from '../auth';
import { t } from '../i18n';

export const TOKEN_SECRET_ID = 'simple-microsoft-todo-refresh-token';

export class AuthSession {
    version = 0;
    oauth = new AuthManager();
    private accessToken = '';
    private refreshToken = '';
    private expiresAt = 0;
    private verifier = '';
    private refreshPromise: Promise<string> | null = null;

    constructor(private readonly storage: SecretStorage) {}

    get signedIn(): boolean {
        return !!this.refreshToken;
    }

    restore(legacyRefreshToken?: unknown) {
        const stored = this.storage.getSecret(TOKEN_SECRET_ID);
        if (stored) {
            this.refreshToken = stored;
        } else if (typeof legacyRefreshToken === 'string' && legacyRefreshToken) {
            this.storage.setSecret(TOKEN_SECRET_ID, legacyRefreshToken);
            if (this.storage.getSecret(TOKEN_SECRET_ID) !== legacyRefreshToken) {
                throw new Error(t('account.storageFailed'));
            }
            this.refreshToken = legacyRefreshToken;
        }
    }

    async login() {
        this.invalidate();
        const version = this.version;
        this.verifier = this.oauth.generateCodeVerifier();
        const url = await this.oauth.getAuthUrl(this.verifier);
        if (version === this.version) window.open(url);
    }

    async completeLogin(code: string): Promise<boolean> {
        if (!this.verifier) return false;
        const version = this.version;
        const verifier = this.verifier;
        this.verifier = '';
        const tokens = await this.oauth.exchangeCodeForToken(code, verifier);
        if (version !== this.version) return false;
        this.acceptTokens(tokens);
        return true;
    }

    isCurrent(version: number): boolean {
        return version === this.version && this.signedIn;
    }

    assertCurrent(version: number) {
        if (!this.isCurrent(version)) throw new Error(t('apiError.noSignInInfo'));
    }

    async getValidToken(version: number): Promise<string> {
        this.assertCurrent(version);
        if (this.accessToken && this.expiresAt - Date.now() >= 5 * 60 * 1000) return this.accessToken;

        if (!this.refreshPromise) {
            const refreshing = this.oauth.refreshAccessToken(this.refreshToken)
                .then(tokens => {
                    this.assertCurrent(version);
                    this.acceptTokens(tokens);
                    return this.accessToken;
                })
                .catch(error => {
                    if (this.isCurrent(version)) new Notice(t('apiError.signInExpired'));
                    throw error;
                })
                .finally(() => {
                    if (this.refreshPromise === refreshing) this.refreshPromise = null;
                });
            this.refreshPromise = refreshing;
        }
        return this.refreshPromise;
    }

    signOut() {
        this.storage.setSecret(TOKEN_SECRET_ID, '');
        this.invalidate();
    }

    invalidate() {
        this.version++;
        this.verifier = '';
        this.accessToken = '';
        this.refreshToken = '';
        this.expiresAt = 0;
        this.refreshPromise = null;
    }

    private acceptTokens(tokens: TokenResponse) {
        const refreshToken = tokens.refresh_token ?? this.refreshToken;
        if (typeof tokens.access_token !== 'string' || !tokens.access_token ||
            typeof refreshToken !== 'string' || !refreshToken ||
            !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
            throw new Error(t('apiError.invalidTokenResponse'));
        }
        this.storage.setSecret(TOKEN_SECRET_ID, refreshToken);
        this.refreshToken = refreshToken;
        this.accessToken = tokens.access_token;
        this.expiresAt = Date.now() + tokens.expires_in * 1000;
    }
}
