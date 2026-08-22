/**
 * Lightweight i18n runtime. No third-party dependencies.
 *
 * - Locale follows Obsidian's current UI language: Simplified Chinese → zh-cn,
 *   everything else → English. Detected via the official `getLanguage()` API
 *   (available since Obsidian 1.8.7) — no DOM/localStorage/moment reliance.
 * - English is the fallback; a key missing from the active locale falls back
 *   to en, then to the raw key.
 * - `{var}` placeholders in templates are interpolated from `vars`.
 */

import { getLanguage } from 'obsidian';
import { en, type TranslationKey } from './locales/en';
import { zhCn } from './locales/zh-cn';

export type { TranslationKey };
export type LocaleCode = 'en' | 'zh-cn';
export type Messages = Record<TranslationKey, string>;

type Vars = Record<string, string | number | undefined>;

function flatten(obj: Record<string, unknown>, prefix = ''): Messages {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out[path] = value;
        else Object.assign(out, flatten(value as Record<string, unknown>, path));
    }
    return out as Messages;
}

const dictionaries: Record<LocaleCode, Messages> = {
    en: flatten(en as unknown as Record<string, unknown>),
    'zh-cn': flatten(zhCn as unknown as Record<string, unknown>),
};

let cached: Messages | null = null;
let localeOverride: LocaleCode | null = null;

function detectLocale(): LocaleCode {
    const lang = getLanguage().toLowerCase().replace('_', '-');
    // Simplified Chinese → zh-cn; everything else (incl. zh-tw) → en.
    return lang === 'zh-cn' || lang === 'zh' ? 'zh-cn' : 'en';
}

function messages(): Messages {
    if (!cached) cached = { ...dictionaries.en, ...dictionaries[localeOverride ?? detectLocale()] };
    return cached;
}

/** Translate a key. `vars` interpolates `{name}` placeholders. */
export function t(key: TranslationKey, vars?: Vars): string {
    let value = messages()[key];
    if (value === undefined) value = dictionaries.en[key] ?? key;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) =>
        vars[name] !== undefined ? String(vars[name]) : match);
}

/** Override the active locale (e.g. a future user setting). Clears the cache. */
export function setLocale(locale: LocaleCode): void {
    localeOverride = locale;
    cached = null;
}

export function getLocale(): LocaleCode {
    return localeOverride ?? detectLocale();
}
