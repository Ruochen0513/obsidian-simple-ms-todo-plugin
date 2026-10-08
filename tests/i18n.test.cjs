const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup } = require('./helpers.cjs');

test('Chinese and English have matching keys and interpolation variables', () => {
    const { en, zhCn } = setup();
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zhCn).sort());
    const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(en)) {
        assert(zhCn[key].trim(), key);
        assert.deepEqual(placeholders(en[key]), placeholders(zhCn[key]), key);
    }
});

test('automatic language follows the host and explicit language overrides it', () => {
    const { t, setLocale, host } = setup();
    assert.equal(t('common.signIn'), 'Sign in');
    host.language = 'zh_Hans_CN';
    assert.equal(t('common.signIn'), '登录');
    setLocale('en');
    assert.equal(t('common.signIn'), 'Sign in');
    setLocale('zh-cn');
    assert.equal(t('common.signIn'), '登录');
    setLocale('auto');
    host.language = 'fr';
    assert.equal(t('common.signIn'), 'Sign in');
});

test('translations preserve zero values and interpolate names without interpreting markup', () => {
    const { t, setLocale } = setup();
    const vars = { listCount: 0, taskCount: 0, path: 'Tasks.md' };
    assert.match(t('notices.syncCompleted', vars), /0 tasks from 0 lists/);
    setLocale('zh-cn');
    assert.equal(t('notices.taskAddedWithDate', { listName: '<我的任务>', date: '10月20日' }), '已添加到「<我的任务>」，截止 10月20日');
});

test('dates and export timestamps follow plugin language and preserve the calendar date', () => {
    const { setLocale, formatDisplayDate, formatTimestamp } = setup();
    setLocale('en');
    assert.equal(formatDisplayDate('2026-10-08T00:00:00'), 'Oct 8, 2026');
    const date = new Date(2026, 9, 8, 16, 30);
    const english = formatTimestamp(date);
    setLocale('zh-cn');
    assert.equal(formatDisplayDate('2026-10-08T00:00:00'), '2026年10月8日');
    assert.notEqual(formatTimestamp(date), english);
    assert.equal(formatDisplayDate('2026-02-31'), '2026-02-31');
});

test('switching language preserves command IDs and updates their names', async () => {
    const { plugin } = setup();
    plugin.refreshView = () => {};
    await plugin.setPluginLocale('zh-cn');
    const ids = Array.from(plugin.commands.keys());
    assert.deepEqual(ids, ['open-view', 'quick-capture', 'sync-to-markdown']);
    assert.equal(plugin.commands.get('sync-to-markdown').name, '导出 Microsoft To Do 到 Markdown');
    await plugin.setPluginLocale('en');
    assert.deepEqual(Array.from(plugin.commands.keys()), ids);
    assert.equal(plugin.commands.get('sync-to-markdown').name, 'Export Microsoft To Do to Markdown');
});

test('invalid saved settings use defaults and do not become runtime options', () => {
    const { readSettings } = setup();
    const settings = readSettings({ locale: 'invalid', syncOnStartup: 'false', markdownSyncPath: ' ', refreshToken: 'secret' });
    assert.equal(settings.locale, 'auto');
    assert.equal(settings.syncOnStartup, false);
    assert.equal(settings.markdownSyncPath, 'Microsoft To Do.md');
    assert.equal('refreshToken' in settings, false);
});
