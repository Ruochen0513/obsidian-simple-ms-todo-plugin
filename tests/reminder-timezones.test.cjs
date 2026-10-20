const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, task } = require('./helpers.cjs');

function inTimeZone(zone, run) {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try { run(); } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
}

function dateKey(instant) {
    const date = new Date(instant);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function reminder(dateTime, timeZone) {
    return { ...task, isReminderOn: true, reminderDateTime: { dateTime, timeZone } };
}

test('Windows reminder zones use device dates across DST and year boundaries', () => {
    for (const deviceZone of ['Asia/Shanghai', 'America/New_York', 'UTC']) {
        inTimeZone(deviceZone, () => {
            const { getPlannedDate, groupPlannedTasks } = setup();
            for (const [dateTime, offset] of [
                ['2026-10-20T20:00:00.0000000', '-07:00'],
                ['2026-12-31T20:00:00', '-08:00'],
                ['2026-03-08T03:30:00', '-07:00'],
                ['2026-11-01T03:30:00', '-08:00'],
            ]) {
                const expected = dateKey(dateTime + offset);
                const value = reminder(dateTime, 'Pacific Standard Time');
                assert.equal(getPlannedDate(value), expected, `${deviceZone}: ${dateTime}`);
                const now = new Date(expected + 'T12:00:00');
                assert.equal(groupPlannedTasks([value], now).today.length, 1);
            }
        });
    }
});

test('IANA reminder zones include fractional-hour offsets and large date changes', () => {
    inTimeZone('Asia/Shanghai', () => {
        const { getPlannedDate } = setup();
        for (const [dateTime, timeZone, offset] of [
            ['2026-10-20T20:00:00', 'America/Los_Angeles', '-07:00'],
            ['2026-10-20T23:00:00', 'Asia/Kolkata', '+05:30'],
            ['2027-01-01T00:30:00', 'Pacific/Kiritimati', '+14:00'],
        ]) {
            assert.equal(getPlannedDate(reminder(dateTime, timeZone)), dateKey(dateTime + offset));
        }
    });
});

test('explicit reminder offsets take precedence over the separate time zone name', () => {
    inTimeZone('Asia/Shanghai', () => {
        const { getPlannedDate } = setup();
        const value = '2026-10-20T20:00:00-07:00';
        assert.equal(getPlannedDate(reminder(value, 'UTC')), dateKey(value));
    });
});

test('invalid reminder dates and unknown named zones do not create bogus plans', () => {
    const { getPlannedDate } = setup();
    for (const [value, zone] of [
        ['invalid', 'Pacific Standard Time'],
        ['2026-02-30T20:00:00', 'America/Los_Angeles'],
        ['2026-10-20T25:00:00', 'Asia/Shanghai'],
        ['2026-10-20T20:00:00', 'Unknown/TimeZone'],
    ]) assert.equal(getPlannedDate(reminder(value, zone)), '');
});

test('due dates stay calendar dates even when the reminder is in another zone', () => {
    inTimeZone('Asia/Shanghai', () => {
        const { getPlannedDate } = setup();
        assert.equal(getPlannedDate({
            ...reminder('2026-10-20T20:00:00', 'Pacific Standard Time'),
            dueDateTime: { dateTime: '2026-10-20T00:00:00', timeZone: 'UTC' },
        }), '2026-10-20');
    });
});
