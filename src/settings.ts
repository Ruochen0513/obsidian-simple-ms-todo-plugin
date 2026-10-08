import type { LocalePreference } from './i18n';

export interface MsTodoSettings {
    markdownSyncEnabled: boolean;
    markdownSyncPath: string;
    syncAfterLogin: boolean;
    syncOnStartup: boolean;
    locale: LocalePreference;
    defaultViewId: string;
}

export const DEFAULT_SETTINGS: MsTodoSettings = {
    markdownSyncEnabled: false,
    markdownSyncPath: 'Microsoft To Do.md',
    syncAfterLogin: true,
    syncOnStartup: false,
    locale: 'auto',
    defaultViewId: '__planned__',
};

export function readSettings(value: unknown): MsTodoSettings {
    const settings = { ...DEFAULT_SETTINGS };
    if (!value || typeof value !== 'object') return settings;
    const data = value as Record<string, unknown>;
    for (const key of ['markdownSyncEnabled', 'syncAfterLogin', 'syncOnStartup'] as const) {
        if (typeof data[key] === 'boolean') settings[key] = data[key] as boolean;
    }
    if (typeof data.markdownSyncPath === 'string' && data.markdownSyncPath.trim()) {
        settings.markdownSyncPath = data.markdownSyncPath.trim();
    }
    if (data.locale === 'auto' || data.locale === 'en' || data.locale === 'zh-cn') {
        settings.locale = data.locale;
    }
    if (typeof data.defaultViewId === 'string' && data.defaultViewId.trim() && data.defaultViewId.trim() !== '__completed__') {
        settings.defaultViewId = data.defaultViewId.trim();
    }
    return settings;
}
