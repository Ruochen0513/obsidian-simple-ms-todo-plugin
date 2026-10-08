import { getLanguage } from 'obsidian';
import { en, type TranslationKey } from './locales/en';
import { zhCn } from './locales/zh-cn';

export type { TranslationKey };
export type LocaleCode = 'en' | 'zh-cn';
export type LocalePreference = 'auto' | LocaleCode;
export type Messages = Record<TranslationKey, string>;
type Vars = Record<string, string | number | undefined>;

const dictionaries: Record<LocaleCode, Messages> = { en, 'zh-cn': zhCn };
let localePreference: LocalePreference = 'auto';

export function getLocale(): LocaleCode {
    if (localePreference !== 'auto') return localePreference;
    const language = getLanguage().toLowerCase().replace(/_/g, '-');
    return language === 'zh' || language === 'zh-cn' || language === 'zh-sg' || language.startsWith('zh-hans')
        ? 'zh-cn' : 'en';
}

export function t(key: TranslationKey, vars?: Vars): string {
    const value = dictionaries[getLocale()][key] ?? en[key] ?? key;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) =>
        vars[name] !== undefined ? String(vars[name]) : match);
}

export function setLocale(locale: LocalePreference): void {
    localePreference = locale === 'en' || locale === 'zh-cn' ? locale : 'auto';
}

export function formatTimestamp(date: Date): string {
    return new Intl.DateTimeFormat(getLocale(), {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(date);
}
