import { TZDateMini } from '@date-fns/tz/date/mini';
import { findIana } from 'windows-iana';
import type { TodoDateTime } from '../api/ms-todo-api';

const timeZones = new Map<string, string | null>();

function resolveTimeZone(name: string): string | null {
    if (timeZones.has(name)) return timeZones.get(name)!;
    let zone: string | null = name;
    try {
        new Intl.DateTimeFormat('en', { timeZone: name });
    } catch {
        zone = findIana(name)[0] ?? null;
    }
    timeZones.set(name, zone);
    return zone;
}

/** Convert Graph reminder instants; due dates deliberately do not use this conversion. */
export function parseReminderDate(reminder: TodoDateTime): Date | null {
    const value = reminder.dateTime;
    if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/.exec(value);
    if (!parts) return null;
    const year = Number(parts[1]);
    const month = Number(parts[2]) - 1;
    const day = Number(parts[3]);
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = Number(parts[6]);
    const millisecond = Number((parts[7] || '').padEnd(3, '0').slice(0, 3));
    const calendar = new Date(Date.UTC(year, month, day, hour, minute, second));
    if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== value.slice(0, 19)) return null;

    const zone = resolveTimeZone(reminder.timeZone || 'UTC');
    if (!zone) return null;
    // Numeric components preserve the reminder's wall time rather than interpreting it on this device.
    const date = new TZDateMini(year, month, day, hour, minute, second, millisecond, zone);
    return Number.isNaN(date.getTime()) ? null : new Date(date.getTime());
}
