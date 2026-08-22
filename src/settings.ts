export interface MsTodoSettings {
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: number;
    markdownSyncEnabled: boolean;
    markdownSyncPath: string;
    syncAfterLogin: boolean;
    syncOnStartup: boolean;
}

export const DEFAULT_SETTINGS: MsTodoSettings = {
    accessToken: '',
    refreshToken: '',
    tokenExpiresAt: 0,
    markdownSyncEnabled: false,
    markdownSyncPath: 'Microsoft To Do.md',
    syncAfterLogin: true,
    syncOnStartup: false,
};
