const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, list, task } = require('./helpers.cjs');

function confirmDeletion(context) {
    const { view, api, modals } = context;
    const deleting = view.confirmAndDeleteTask(api, list, view.mainListArea, view.mainDetail, task);
    modals.at(-1).contentEl.querySelector('.todo-delete-confirm-button').onclick();
    return deleting;
}

function assertDeleted({ view }) {
    assert.equal(view.currentTasks.length, 0);
    assert.equal(view.taskCache.get(list.id).tasks.length, 0);
    assert.equal(view.mainListArea.querySelectorAll('.todo-task-row').length, 0);
}

test('a late edit response cannot restore a successfully deleted task', async () => {
    const c = setup();
    const response = deferred();
    c.api.deleteTask = async () => {};
    const editing = c.view.saveTaskChange(c.api, list, c.view.mainListArea, c.view.mainDetail,
        task, () => response.promise, 'Edit saved');
    await confirmDeletion(c);
    response.resolve({ ...task, importance: 'high' });
    await editing;
    assertDeleted(c);
    assert.equal(c.notices.includes('Edit saved'), false);
});

test('an edit response received during deletion stays hidden and deletion failure allows retry', async () => {
    const c = setup();
    const response = deferred();
    const deletion = deferred();
    c.api.deleteTask = () => deletion.promise;
    const editing = c.view.saveTaskChange(c.api, list, c.view.mainListArea, c.view.mainDetail,
        task, () => response.promise, 'Edit saved');
    const deleting = confirmDeletion(c);
    response.resolve({ ...task, importance: 'high' });
    await editing;
    assertDeleted(c);
    deletion.reject(new Error('Deletion failed'));
    await deleting;
    await c.view.saveTaskChange(c.api, list, c.view.mainListArea, c.view.mainDetail,
        task, async () => ({ ...task, title: 'Retry succeeds' }), 'Retry saved');
    assert.equal(c.view.currentTasks[0].title, 'Retry succeeds');
    assert.equal(c.view.taskCache.get(list.id).tasks[0].title, 'Retry succeeds');
});

test('a stale refresh cannot restore a deleted task to the view or cache', async () => {
    const c = setup();
    const response = deferred();
    c.api.getTasks = () => response.promise;
    c.api.deleteTask = async () => {};
    const refreshing = c.view.refreshCachedList(c.api, list, c.view.mainListArea, c.view.mainDetail);
    await confirmDeletion(c);
    response.resolve([task]);
    await refreshing;
    assertDeleted(c);
});

test('deletion markers do not leak into another sign-in session', async () => {
    const c = setup();
    c.api.deleteTask = async () => {};
    await confirmDeletion(c);
    await c.plugin.clearData();
    c.plugin.session.restore('new-account');
    c.view.renderShell = async () => {};
    c.MsTodoApi.prototype.getTaskLists = async () => [list];
    await c.view.render();
    c.view.upsertTaskInCache(list.id, task);
    assert.equal(c.view.taskCache.get(list.id).tasks[0].id, task.id);
});
