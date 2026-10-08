const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, task, list } = require('./helpers.cjs');

test('legacy credentials migrate to Keychain before plaintext fields are removed', async () => {
    const data = { accessToken: 'legacy-access', refreshToken: 'legacy-refresh', tokenExpiresAt: 123,
        locale: 'zh-cn', markdownSyncEnabled: true, markdownSyncPath: 'Tasks/export.md' };
    const { plugin, secrets, TOKEN_SECRET_ID } = setup({ signedIn: false, data });
    const save = plugin.saveData.bind(plugin);
    plugin.saveData = async payload => {
        assert.equal(secrets.get(TOKEN_SECRET_ID), 'legacy-refresh');
        await save(payload);
    };
    await plugin.loadSettings();
    assert.equal(plugin.session.signedIn, true);
    assert.equal(plugin.saved.locale, 'zh-cn');
    assert.equal(plugin.saved.markdownSyncPath, 'Tasks/export.md');
    for (const field of ['accessToken', 'refreshToken', 'tokenExpiresAt']) {
        assert.equal(field in plugin.settings, false);
        assert.equal(field in plugin.saved, false);
    }
});

test('a failed Keychain migration leaves the old data file intact', async () => {
    const data = { refreshToken: 'legacy-refresh', locale: 'en' };
    const { plugin, storage } = setup({ signedIn: false, data });
    storage.setSecret = () => { throw new Error('Locked Keychain'); };
    await assert.rejects(plugin.loadSettings(), /Keychain/);
    assert.equal(plugin.saved, undefined);
    assert.equal(plugin.session.signedIn, false);
    assert.equal(data.refreshToken, 'legacy-refresh');
});

test('migration can retry if saving the sanitized settings failed', async () => {
    const data = { refreshToken: 'legacy-refresh' };
    const { plugin, secrets, TOKEN_SECRET_ID } = setup({ signedIn: false, data });
    const save = plugin.saveData.bind(plugin);
    plugin.saveData = async () => { throw new Error('Disk full'); };
    await assert.rejects(plugin.loadSettings(), /Disk full/);
    assert.equal(secrets.get(TOKEN_SECRET_ID), 'legacy-refresh');
    plugin.saveData = save;
    await plugin.loadSettings();
    assert.equal('refreshToken' in plugin.saved, false);
});

test('ordinary settings saves cannot serialize credentials or unknown fields', async () => {
    const { plugin } = setup();
    Object.assign(plugin.settings, { accessToken: 'must-not-save', refreshToken: 'must-not-save', unknown: 'ignored' });
    await plugin.saveSettings();
    assert.equal('accessToken' in plugin.saved, false);
    assert.equal('refreshToken' in plugin.saved, false);
    assert.equal('unknown' in plugin.saved, false);
});

test('an existing Keychain credential wins over a stale plaintext copy', async () => {
    const { plugin, secrets, TOKEN_SECRET_ID } = setup({ signedIn: false, data: { refreshToken: 'old-copy' } });
    secrets.set(TOKEN_SECRET_ID, 'current-refresh');
    let used;
    plugin.session.oauth.refreshAccessToken = async token => {
        used = token;
        return { access_token: 'access', expires_in: 3600 };
    };
    await plugin.loadSettings();
    await plugin.session.getValidToken(plugin.session.version);
    assert.equal(used, 'current-refresh');
    assert.equal(secrets.get(TOKEN_SECRET_ID), 'current-refresh');
});

test('separate API clients share one refresh and persist the rotated refresh token', async () => {
    const { plugin, api, MsTodoApi, network, secrets, TOKEN_SECRET_ID } = setup();
    let refreshCount = 0;
    const response = deferred();
    plugin.session.oauth.refreshAccessToken = () => { refreshCount++; return response.promise; };
    const authorizations = [];
    network.request = async options => {
        authorizations.push(options.headers.Authorization);
        return { status: 200, json: { value: [] } };
    };
    const first = api.getTaskLists();
    const second = new MsTodoApi(plugin).getTaskLists();
    response.resolve({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
    await Promise.all([first, second]);
    assert.equal(refreshCount, 1);
    assert.deepEqual(authorizations, ['Bearer new-access', 'Bearer new-access']);
    assert.equal(secrets.get(TOKEN_SECRET_ID), 'rotated-refresh');
    assert.equal(JSON.stringify(plugin.saved || {}).includes('new-access'), false);
});

test('sign-out clears Keychain and tasks while preserving language and export preferences', async () => {
    const { plugin, secrets, TOKEN_SECRET_ID } = setup();
    Object.assign(plugin.settings, { locale: 'zh-cn', markdownSyncEnabled: true, markdownSyncPath: 'Work/tasks.md' });
    await plugin.clearData();
    assert.equal(secrets.get(TOKEN_SECRET_ID), '');
    assert.equal(plugin.session.signedIn, false);
    assert.equal(plugin.saved.locale, 'zh-cn');
    assert.equal(plugin.saved.markdownSyncPath, 'Work/tasks.md');
    assert.equal(plugin.saved.markdownSyncEnabled, true);
});

test('a failed Keychain clear does not pretend sign-out succeeded', async () => {
    const { plugin, storage, notices } = setup();
    storage.setSecret = () => { throw new Error('Locked Keychain'); };
    await plugin.clearData();
    assert.equal(plugin.session.signedIn, true);
    assert.match(notices.at(-1), /still signed in/);
});

test('a device without local credentials does not display an imported task cache', async () => {
    const data = { taskCacheSnapshot: { version: 1, savedAt: 123, lists: [list],
        entries: { [list.id]: { tasks: [task], allLoaded: true, updatedAt: 123 } } } };
    const { plugin } = setup({ signedIn: false, data });
    await plugin.loadSettings();
    assert.equal(plugin.taskCacheSnapshot, null);
    assert.equal(plugin.session.signedIn, false);
});

test('invalid token responses never overwrite the stored refresh token', async () => {
    for (const response of [
        { access_token: '', refresh_token: 'bad', expires_in: 3600 },
        { access_token: 'access', refresh_token: 'bad', expires_in: -1 },
        { access_token: 'access', refresh_token: 123, expires_in: 3600 },
    ]) {
        const { plugin, secrets, TOKEN_SECRET_ID } = setup();
        plugin.session.oauth.refreshAccessToken = async () => response;
        await assert.rejects(plugin.session.getValidToken(plugin.session.version), /incomplete/);
        assert.equal(secrets.get(TOKEN_SECRET_ID), 'test-refresh');
    }
});
