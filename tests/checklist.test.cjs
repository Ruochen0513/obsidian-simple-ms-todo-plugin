const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, list } = require('./helpers.cjs');

const settle = () => new Promise(setImmediate);

function openChecklist() {
    const context = setup();
    const { view, api } = context;
    const task = view.currentTasks[0];
    task.checklistItems = ['a', 'b'].map(id => ({ id, displayName: id, isChecked: false }));
    view.selectTask(api, list, view.mainListArea, view.mainDetail, task);
    const controls = id => {
        const index = task.checklistItems.findIndex(item => item.id === id);
        const row = view.mainDetail.querySelectorAll('.todo-step-row')[index];
        return {
            checkbox: row.children.find(child => child.tagName === 'INPUT'),
            remove: row.querySelector('.todo-step-remove'),
        };
    };
    return {
        ...context, task, controls,
        toggle(id) {
            const { checkbox } = controls(id);
            checkbox.checked = !checkbox.checked;
            checkbox.onchange();
        },
        remove(id) { controls(id).remove.onclick(); },
        add(name) {
            const input = view.mainDetail.querySelector('.todo-step-add-input');
            input.value = name;
            input.emit('keydown', { key: 'Enter', preventDefault() {} });
        },
        state: () => Object.fromEntries(task.checklistItems.map(item => [item.id, item.isChecked])),
    };
}

test('a failed step update preserves another successful update in the view and saved cache', async () => {
    const c = openChecklist();
    const first = deferred();
    c.api.updateChecklistItem = (_list, _task, id) => id === 'a' ? first.promise : Promise.resolve();
    c.toggle('a');
    c.toggle('b');
    await settle();
    first.reject(new Error('Update failed'));
    await settle();
    assert.deepEqual(c.state(), { a: false, b: true });
    assert.equal(c.controls('b').checkbox.checked, true);
    await c.view.persistTaskCache();
    const saved = c.plugin.saved.taskCacheSnapshot.entries[list.id].tasks[0].checklistItems;
    assert.equal(saved.find(item => item.id === 'b').isChecked, true);
});

test('independent failed updates each restore their own step', async () => {
    const c = openChecklist();
    const first = deferred();
    const second = deferred();
    c.api.updateChecklistItem = (_list, _task, id) => id === 'a' ? first.promise : second.promise;
    c.toggle('a');
    c.toggle('b');
    first.reject(new Error('First failed'));
    await settle();
    second.reject(new Error('Second failed'));
    await settle();
    assert.deepEqual(c.state(), { a: false, b: false });
});

test('a failed deletion restores only that step without resurrecting another deleted step', async () => {
    const c = openChecklist();
    const first = deferred();
    c.api.deleteChecklistItem = (_list, _task, id) => id === 'a' ? first.promise : Promise.resolve();
    c.remove('a');
    c.remove('b');
    await settle();
    first.reject(new Error('Delete failed'));
    await settle();
    assert.deepEqual(c.state(), { a: false });
});

test('a failed creation removes only its temporary step and preserves another created step', async () => {
    const c = openChecklist();
    const first = deferred();
    c.api.createChecklistItem = (_list, _task, name) => name === 'first' ? first.promise
        : Promise.resolve({ id: 'created', displayName: name, isChecked: false });
    c.add('first');
    c.add('second');
    await settle();
    first.reject(new Error('Create failed'));
    await settle();
    assert.deepEqual(c.state(), { a: false, b: false, created: false });
});

test('a failed update does not undo another step deletion', async () => {
    const c = openChecklist();
    const first = deferred();
    c.api.updateChecklistItem = () => first.promise;
    c.api.deleteChecklistItem = async () => {};
    c.toggle('a');
    c.remove('b');
    await settle();
    first.reject(new Error('Update failed'));
    await settle();
    assert.deepEqual(c.state(), { a: false });
});

test('the same pending step cannot be updated or deleted again and is enabled after failure', async () => {
    const c = openChecklist();
    const response = deferred();
    let updates = 0;
    let deletions = 0;
    c.api.updateChecklistItem = () => { updates++; return response.promise; };
    c.api.deleteChecklistItem = async () => { deletions++; };
    c.toggle('a');
    assert.equal(c.controls('a').checkbox.disabled, true);
    assert.equal(c.controls('a').remove.disabled, true);
    c.toggle('a');
    c.remove('a');
    assert.equal(updates, 1);
    assert.equal(deletions, 0);
    response.reject(new Error('Update failed'));
    await settle();
    assert.equal(c.controls('a').checkbox.disabled, false);
    assert.equal(c.controls('a').remove.disabled, false);
    assert.deepEqual(c.state(), { a: false, b: false });
});

test('a new step waits for its real ID before accepting updates or deletion', async () => {
    const c = openChecklist();
    const response = deferred();
    let requests = 0;
    c.api.createChecklistItem = () => response.promise;
    c.api.updateChecklistItem = c.api.deleteChecklistItem = async () => { requests++; };
    c.add('new');
    const temporaryId = c.task.checklistItems.at(-1).id;
    assert.equal(c.controls(temporaryId).checkbox.disabled, true);
    c.toggle(temporaryId);
    c.remove(temporaryId);
    assert.equal(requests, 0);
    response.resolve({ id: 'created', displayName: 'new', isChecked: false });
    await settle();
    assert.equal(c.controls('created').checkbox.disabled, false);
    assert.deepEqual(c.state(), { a: false, b: false, created: false });
});

test('a successful update unlocks the step without erasing text being typed', async () => {
    const c = openChecklist();
    const response = deferred();
    c.api.updateChecklistItem = () => response.promise;
    c.toggle('a');
    c.view.mainDetail.querySelector('.todo-title-input').value = 'Draft title';
    c.view.mainDetail.querySelector('.todo-step-add-input').value = 'Next step';
    response.resolve();
    await settle();
    assert.equal(c.controls('a').checkbox.disabled, false);
    assert.equal(c.view.mainDetail.querySelector('.todo-title-input').value, 'Draft title');
    assert.equal(c.view.mainDetail.querySelector('.todo-step-add-input').value, 'Next step');
});

test('a pending step failure after sign-out cannot restore tasks or leave pending locks', async () => {
    const c = openChecklist();
    const response = deferred();
    c.api.updateChecklistItem = () => response.promise;
    c.toggle('a');
    await c.plugin.clearData();
    const notices = c.notices.length;
    response.reject(new Error('Late failure'));
    await settle();
    assert.equal(c.view.currentTasks.length, 0);
    assert.equal(c.view.taskCache.size, 0);
    assert.equal(c.view.pendingChecklistItemIds.size, 0);
    assert.equal(c.notices.length, notices);
});

test('confirming a Chinese input candidate does not create a checklist step', async () => {
    const c = openChecklist();
    let creations = 0;
    c.api.createChecklistItem = async (_list, _task, name) => {
        creations++;
        return { id: 'created', displayName: name, isChecked: false };
    };
    const input = c.view.mainDetail.querySelector('.todo-step-add-input');
    input.value = '准备资料';
    input.emit('keydown', { key: 'Enter', isComposing: true });
    assert.equal(creations, 0);
    input.emit('keydown', { key: 'Enter', isComposing: false, preventDefault() {} });
    await settle();
    assert.equal(creations, 1);
    assert.equal(c.task.checklistItems.at(-1).displayName, '准备资料');
});
