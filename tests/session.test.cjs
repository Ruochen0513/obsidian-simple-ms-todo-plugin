const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, list, task } = require('./helpers.cjs');

test('a normal token refresh is saved and shared by concurrent requests', async () => {
    const { plugin, api } = setup();
    const response = deferred();
    let calls = 0;
    plugin.session.oauth.refreshAccessToken = () => { calls++; return response.promise; };
    const first = plugin.session.getValidToken(plugin.session.version);
    const second = plugin.session.getValidToken(plugin.session.version);
    response.resolve({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
    assert.equal(await first, 'new-access');
    assert.equal(await second, 'new-access');
    assert.equal(plugin.app.secretStorage.getSecret('simple-microsoft-todo-refresh-token'), 'new-refresh');
    assert.equal(calls, 1);
});

test('responses and API instances from an old account cannot affect a new account', async () => {
    const { plugin, api, view, network } = setup();
    const response = deferred();
    const started = deferred();
    let calls = 0;
    network.request = () => { calls++; started.resolve(); return response.promise; };
    view.taskCache.clear();
    const loading = view.ensureAllTasksLoaded(api, list.id);
    await started.promise;
    await plugin.clearData();
    plugin.session.restore('different-account');
    response.resolve({ status: 200, json: { value: [task] } });
    await assert.rejects(loading);
    await assert.rejects(api.getTaskLists());
    assert.equal(view.taskCache.size, 0);
    assert.equal(calls, 1);
    assert.equal(plugin.app.secretStorage.getSecret('simple-microsoft-todo-refresh-token'), 'different-account');
});

test('an old completion failure does not roll tasks back into a signed-out view', async () => {
    const { plugin, api, view, network } = setup();
    const response = deferred();
    const started = deferred();
    network.request = () => { started.resolve(); return response.promise; };
    const completing = view.toggleTaskCompletionOptimistically(api, list, view.mainListArea, view.mainDetail, task);
    await started.promise;
    await plugin.clearData();
    response.reject(new Error('Network failure'));
    await completing;
    assert.equal(view.currentTasks.length, 0);
    assert.equal(view.taskCache.size, 0);
    assert.equal(view.selectedTaskId, null);
    assert.equal(plugin.taskCacheSnapshot, null);
});

test('a normal completion failure still restores the task', async () => {
    const { api, view } = setup();
    api.completeTask = async () => { throw new Error('Network failure'); };
    await view.toggleTaskCompletionOptimistically(api, list, view.mainListArea, view.mainDetail, task);
    assert.equal(view.currentTasks[0].status, 'notStarted');
    assert.equal(view.taskCache.get(list.id).tasks[0].status, 'notStarted');
    assert.equal(view.pendingTaskIds.size, 0);
});

test('sign-out invalidates a pending login callback', async () => {
    const { plugin } = setup();
    const response = deferred();
    await plugin.session.login();
    plugin.session.oauth.exchangeCodeForToken = () => response.promise;
    const login = plugin.handleAuthCallback({ code: 'test-code' });
    await plugin.clearData();
    response.resolve({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 });
    await login;
    assert.equal(plugin.saved.accessToken, undefined);
    assert.equal(plugin.session.signedIn, false);
    assert.equal(await plugin.session.completeLogin('late-code'), false);
});

test('sign-out is persisted after any earlier slow settings save', async () => {
    const { plugin } = setup();
    const blockedWrite = deferred();
    const started = deferred();
    const writes = [];
    plugin.saveData = async data => {
        writes.push(data);
        if (writes.length === 1) { started.resolve(); await blockedWrite.promise; }
        plugin.saved = structuredClone(data);
    };
    const earlierSave = plugin.saveSettings();
    await started.promise;
    const signingOut = plugin.clearData();
    blockedWrite.resolve();
    await Promise.all([earlierSave, signingOut]);
    assert.equal(writes.length, 2);
    assert.equal(plugin.saved.accessToken, undefined);
    assert.equal(plugin.session.signedIn, false);
    assert.equal(plugin.saved.taskCacheSnapshot, undefined);
});

test('a detached view cannot persist its old cache after a new login', async () => {
    const { plugin, view } = setup();
    plugin.app.workspace.getLeavesOfType = () => [];
    await plugin.clearData();
    plugin.session.restore('different-account');
    await view.persistTaskCache();
    assert.equal(plugin.taskCacheSnapshot, null);
});
