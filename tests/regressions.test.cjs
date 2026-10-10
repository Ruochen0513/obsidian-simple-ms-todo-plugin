const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, Element, list, task } = require('./helpers.cjs');

test('sign-out rejects a pending token refresh and clears view data and timers', async () => {
    const { plugin, view, api, timers } = setup();
    const refresh = deferred();
    plugin.session.oauth.refreshAccessToken = () => refresh.promise;
    const token = plugin.session.getValidToken(plugin.session.version);
    view.scheduleCachePersist();
    const timer = view.cachePersistTimer;
    await plugin.clearData();
    refresh.resolve({ access_token: 'stale-access', refresh_token: 'stale-refresh', expires_in: 3600 });
    await assert.rejects(token);
    await view.persistTaskCache();
    assert.equal(plugin.saved.accessToken, undefined);
    assert.equal(plugin.session.signedIn, false);
    assert.equal(plugin.saved.taskCacheSnapshot, undefined);
    assert.equal(view.taskCache.size, 0);
    assert.equal(view.currentTasks.length, 0);
    assert.equal(timers.has(timer), false);
});

test('plain-text notes keep literal tags and entities in the editor and export', () => {
    const { view, api, buildMarkdownDocument } = setup();
    const content = 'List<T> and <tag> &lt;literal&gt; **plain**';
    const inputTask = { ...task, body: { contentType: 'text', content } };
    view.selectTask(api, list, view.mainListArea, view.mainDetail, inputTask);
    assert.equal(view.mainDetail.querySelector('.todo-note-input').value, content);
    const markdown = buildMarkdownDocument([{ list, tasks: [inputTask] }]);
    assert(markdown.includes('List\\<T\\> and \\<tag\\> &amp;lt;literal&amp;gt; \\*\\*plain\\*\\*'));
});

test('HTML notes still convert paragraphs, breaks and entities to text', () => {
    const { view, api } = setup();
    const inputTask = { ...task, body: { contentType: 'html', content: '<p>First &amp; second</p><p>List&lt;T&gt;<br>Next</p>' } };
    view.selectTask(api, list, view.mainListArea, view.mainDetail, inputTask);
    assert.equal(view.mainDetail.querySelector('.todo-note-input').value, 'First & second\n\nList<T>\nNext');
});

test('changing importance preserves an unsaved note draft', async () => {
    const { view, api } = setup();
    view.selectTask(api, list, view.mainListArea, view.mainDetail, task);
    const input = view.mainDetail.querySelector('.todo-note-input');
    input.value = 'Unsaved draft';
    input.emit('input');
    await view.saveTaskChange(api, list, view.mainListArea, view.mainDetail, task, async () => ({ ...task, importance: 'high' }), 'Updated');
    assert.equal(view.mainDetail.querySelector('.todo-note-input').value, 'Unsaved draft');
});

test('quick capture reports partial success without allowing duplicate creation', async () => {
    const { QuickCaptureModal, plugin, api, notices, view } = setup();
    let created = 0;
    api.createTask = async () => ({ ...task, id: `created-${++created}` });
    api.updateTaskDueDate = async () => { throw new Error('Date update failed'); };
    const modal = new QuickCaptureModal({}, plugin, api, [list], list.id);
    modal.titleInput = { value: 'Quick task' };
    modal.listSelect = { value: list.id };
    modal.dueDateInput = { value: '2026-10-20' };
    modal.confirmButton = new Element();
    await modal.submit();
    await modal.submit();
    assert.equal(created, 1);
    assert.equal(modal.closed, true);
    assert(view.taskCache.get(list.id).tasks.some(item => item.id === 'created-1'));
    assert.match(notices.at(-1), /created.*Test list.*due date failed/i);
});

test('a list refresh finishing during search updates cache without replacing results', async () => {
    const { view, api } = setup();
    const response = deferred();
    api.getTasks = () => response.promise;
    const refresh = view.refreshCachedList(api, list, view.mainListArea, view.mainDetail);
    view.searchQuery = 'needle';
    const results = view.currentTasks;
    response.resolve([task, { ...task, id: 'unrelated', title: 'Other' }]);
    await refresh;
    assert.equal(view.currentTasks, results);
    assert.equal(view.taskCache.get(list.id).tasks.length, 2);
});
