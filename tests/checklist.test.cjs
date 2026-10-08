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

const keyEvent = key => ({ key, preventDefault() {}, stopPropagation() {} });
const rowFor = (c, id) => c.view.mainDetail.querySelectorAll('.todo-step-row').find(row => row.getAttr('data-step-id') === id);
const orderInView = c => c.view.mainDetail.querySelectorAll('.todo-step-row').map(row => row.getAttr('data-step-id'));
const orderKey = JSON.stringify([list.id, 'task-a']);
function edit(c, id, name) {
    const label = rowFor(c, id).querySelector('.todo-step-label');
    label.emit('dblclick', { preventDefault() {} });
    const input = label.querySelector('.todo-step-edit-input');
    input.value = name;
    input.emit('input');
    return input;
}
function move(c, id, key) { rowFor(c, id).querySelector('.todo-step-drag').emit('keydown', keyEvent(key)); }

test('double-click edits a step through PATCH without changing its ID, completion or neighbors', async () => {
    const c = openChecklist();
    c.task.checklistItems[0].isChecked = true;
    c.view.selectTask(c.api, list, c.view.mainListArea, c.view.mainDetail, c.task);
    const calls = [];
    c.api.updateChecklistItem = async (...args) => { calls.push(args); };
    const input = edit(c, 'a', '  修改步骤  ');
    assert.equal(input.hidden, false);
    input.emit('keydown', keyEvent('Enter'));
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[list.id, c.task.id, 'a', { displayName: '修改步骤' }]]);
    assert.equal(c.task.checklistItems[0].id, 'a');
    assert.equal(c.task.checklistItems[0].isChecked, true);
    assert.equal(c.task.checklistItems[0].displayName, '修改步骤');
    assert.equal(c.task.checklistItems[1].displayName, 'b');
    assert.equal(c.view.stepDrafts.size, 0);
});

test('Escape, empty edits and IME confirmation do not send updates; blur saves once', async () => {
    const c = openChecklist();
    let calls = 0;
    c.api.updateChecklistItem = async () => { calls++; };
    let input = edit(c, 'a', 'changed');
    input.emit('keydown', { ...keyEvent('Enter'), isComposing: true });
    assert.equal(calls, 0);
    input.emit('keydown', keyEvent('Escape'));
    input.emit('blur');
    input = edit(c, 'a', '   ');
    input.emit('keydown', keyEvent('Enter'));
    assert.equal(calls, 0);
    input = edit(c, 'a', 'renamed');
    input.emit('blur');
    input.emit('blur');
    await settle();
    assert.equal(calls, 1);
    assert.equal(c.task.checklistItems[0].displayName, 'renamed');
});

test('failed rename restores only its original name and keeps the entered draft for retry', async () => {
    const c = openChecklist();
    const response = deferred();
    c.api.updateChecklistItem = (_list, _task, id) => id === 'a' ? response.promise : Promise.resolve();
    edit(c, 'a', 'retry me').emit('keydown', keyEvent('Enter'));
    c.toggle('b');
    await settle();
    response.reject(new Error('Offline'));
    await settle();
    assert.equal(c.task.checklistItems[0].displayName, 'a');
    assert.equal(c.task.checklistItems[1].isChecked, true);
    const input = rowFor(c, 'a').querySelector('.todo-step-edit-input');
    assert.equal(input.hidden, false);
    assert.equal(input.value, 'retry me');
});

test('refreshing detail preserves an unsaved step draft without submitting it', () => {
    const c = openChecklist();
    c.api.updateChecklistItem = () => { assert.fail('must not submit on redraw'); };
    const previous = edit(c, 'a', 'draft');
    c.view.renderTaskList(c.api, list, c.view.mainListArea, c.view.mainDetail);
    previous.emit('blur');
    const input = rowFor(c, 'a').querySelector('.todo-step-edit-input');
    assert.equal(input.hidden, false);
    assert.equal(input.value, 'draft');
});

test('keyboard reorder persists across reload and server refresh, including returning to the original order', async () => {
    const c = openChecklist();
    move(c, 'b', 'ArrowUp');
    await settle();
    assert.deepEqual(orderInView(c), ['b', 'a']);
    assert.deepEqual(c.plugin.saved.checklistOrders[orderKey], ['b', 'a']);
    const restored = setup({ data: c.plugin.saved });
    await restored.plugin.loadSettings();
    restored.api.getCollection = async () => [{ ...c.task, checklistItems: [
        { id: 'a', displayName: 'a', isChecked: false },
        { id: 'new', displayName: 'new', isChecked: false },
        { id: 'b', displayName: 'b', isChecked: true },
    ] }];
    const tasks = await restored.api.getTasks(list.id);
    assert.deepEqual(Array.from(tasks[0].checklistItems, item => item.id), ['b', 'a', 'new']);
    const markdown = restored.buildMarkdownDocument([{ list, tasks }]);
    assert.ok(markdown.indexOf('- [x] b') < markdown.indexOf('- [ ] a'));
    move(c, 'b', 'ArrowDown');
    await settle();
    assert.deepEqual(c.plugin.saved.checklistOrders[orderKey], ['a', 'b']);
});

test('pointer dragging saves on release; cancellation restores the original order', async () => {
    const c = openChecklist();
    const container = c.view.mainDetail.querySelector('.todo-step-list');
    const handle = rowFor(c, 'b').querySelector('.todo-step-drag');
    const start = { button: 0, isPrimary: true, pointerId: 1, clientY: 60, preventDefault() {} };
    handle.emit('pointerdown', start);
    container.emit('pointermove', { pointerId: 1, clientY: 10 });
    assert.deepEqual(orderInView(c), ['b', 'a']);
    assert.equal(c.plugin.saved, undefined);
    container.emit('pointercancel', { pointerId: 1 });
    assert.deepEqual(orderInView(c), ['a', 'b']);
    handle.emit('pointerdown', start);
    container.emit('pointermove', { pointerId: 1, clientY: 10 });
    container.emit('pointerup', { pointerId: 1 });
    await settle();
    assert.deepEqual(c.plugin.saved.checklistOrders[orderKey], ['b', 'a']);
    assert.equal(container.hasPointerCapture(1), false);
});

test('failed order save restores the view and stored preference and allows retry', async () => {
    const c = openChecklist();
    const save = c.plugin.saveData.bind(c.plugin);
    c.plugin.saveData = async () => { throw new Error('Disk full'); };
    move(c, 'b', 'ArrowUp');
    await settle();
    assert.deepEqual(orderInView(c), ['a', 'b']);
    assert.equal(c.plugin.checklistOrders[orderKey], undefined);
    assert.equal(c.view.pendingChecklistOrderTaskIds.size, 0);
    c.plugin.saveData = save;
    move(c, 'b', 'ArrowUp');
    await settle();
    assert.deepEqual(c.plugin.saved.checklistOrders[orderKey], ['b', 'a']);
});

test('a pending checklist request prevents reorder and protects the local edit from server refresh', async () => {
    const c = openChecklist();
    const response = deferred();
    c.api.updateChecklistItem = () => response.promise;
    edit(c, 'a', 'new name').emit('keydown', keyEvent('Enter'));
    move(c, 'b', 'ArrowUp');
    assert.deepEqual(orderInView(c), ['a', 'b']);
    const merged = c.view.mergeServerTasksWithLocal(list.id, [{ ...c.task, checklistItems: [] }]);
    assert.equal(merged[0].checklistItems[0].displayName, 'new name');
    response.resolve();
    await settle();
    move(c, 'b', 'ArrowUp');
    await settle();
    assert.deepEqual(orderInView(c), ['b', 'a']);
});

test('sign-out clears saved ordering and step drafts, including an in-flight save', async () => {
    const c = openChecklist();
    const response = deferred();
    const save = c.plugin.saveData.bind(c.plugin);
    let count = 0;
    c.plugin.saveData = async payload => {
        if (++count === 1) await response.promise;
        await save(payload);
    };
    edit(c, 'a', 'draft');
    move(c, 'b', 'ArrowUp');
    await settle();
    const signOut = c.plugin.clearData();
    response.resolve();
    await signOut;
    assert.deepEqual(Object.keys(c.plugin.saved.checklistOrders), []);
    assert.equal(c.view.stepDrafts.size, 0);
    assert.equal(c.view.pendingChecklistOrderTaskIds.size, 0);
});

test('a failed order save after redraw restores both the current view and cache', async () => {
    const c = openChecklist();
    const response = deferred();
    c.plugin.saveData = () => response.promise;
    move(c, 'b', 'ArrowUp');
    c.view.renderTaskList(c.api, list, c.view.mainListArea, c.view.mainDetail);
    assert.deepEqual(orderInView(c), ['b', 'a']);
    response.reject(new Error('Disk full'));
    await settle();
    assert.deepEqual(orderInView(c), ['a', 'b']);
    assert.deepEqual(Array.from(c.view.currentTasks[0].checklistItems, item => item.id), ['a', 'b']);
});

test('step editing captures Escape and releases its scope on cancellation and detail cleanup', () => {
    const c = openChecklist();
    let input = edit(c, 'a', 'cancel me');
    input.emit('focus');
    assert.equal(c.scopes.length, 1);
    const escape = c.scopes[0].handlers.find(handler => handler.key === 'Escape');
    assert.equal(escape.callback({ isComposing: false }), false);
    assert.equal(c.scopes.length, 0);
    assert.equal(input.hidden, true);
    input = edit(c, 'a', 'keep draft');
    input.emit('focus');
    c.view.mainDetail.querySelector('.todo-detail-close').onclick();
    assert.equal(c.scopes.length, 0);
    assert.equal(c.view.children.length, 0);
});

test('invalid saved checklist orders are ignored without losing valid entries', async () => {
    const c = setup({ data: { checklistOrders: {
        [orderKey]: ['b', 'a'], invalid: ['a', null], alsoInvalid: 'a',
    } } });
    await c.plugin.loadSettings();
    assert.deepEqual(JSON.parse(JSON.stringify(c.plugin.checklistOrders)), { [orderKey]: ['b', 'a'] });
});
