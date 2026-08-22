import type { LocalePreference } from './i18n';

export interface MsTodoSettings {
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: number;
    markdownSyncEnabled: boolean;
    markdownSyncPath: string;
    syncAfterLogin: boolean;
    syncOnStartup: boolean;
    locale: LocalePreference;
}

export const DEFAULT_SETTINGS: MsTodoSettings = {
    accessToken: '',
    refreshToken: '',
    tokenExpiresAt: 0,
    markdownSyncEnabled: false,
    markdownSyncPath: 'Microsoft To Do.md',
    syncAfterLogin: true,
    syncOnStartup: false,
    locale: 'auto',
};
