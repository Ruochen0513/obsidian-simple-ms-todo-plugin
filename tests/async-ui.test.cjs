const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, Element, list, task } = require('./helpers.cjs');

function openNote(view, api) {
    view.selectTask(api, list, view.mainListArea, view.mainDetail, task);
    const originalSave = view.saveTaskChange.bind(view);
    let pending;
    view.saveTaskChange = (...args) => { pending = originalSave(...args); return pending; };
    return {
        edit(value) {
            const input = view.mainDetail.querySelector('.todo-note-input');
            input.value = value;
            input.emit('input');
        },
        save() { view.mainDetail.querySelector('.todo-save-note').onclick(); return pending; },
        value() { return view.mainDetail.querySelector('.todo-note-input').value; },
    };
}

test('typing while a note is saving preserves the newer draft', async () => {
    const { view, api } = setup();
    const response = deferred();
    let sent;
    api.updateTaskBody = (_list, _id, content) => { sent = content; return response.promise; };
    const note = openNote(view, api);
    note.edit('First draft');
    const saving = note.save();
    note.edit('Newer draft');
    response.resolve({ ...task, body: { contentType: 'text', content: 'First draft' } });
    await saving;
    assert.equal(sent, 'First draft');
    assert.equal(note.value(), 'Newer draft');
});

test('a failed note save keeps its draft across a subsequent redraw', async () => {
    const { view, api } = setup();
    api.updateTaskBody = async () => { throw new Error('Network failure'); };
    const note = openNote(view, api);
    note.edit('Keep this draft');
    await note.save();
    view.renderTaskList(api, list, view.mainListArea, view.mainDetail);
    assert.equal(note.value(), 'Keep this draft');
});

test('saving an empty note clears the draft and allows later server changes', async () => {
    const { view, api } = setup();
    api.updateTaskBody = async (_list, _id, content) => ({ ...task, body: { contentType: 'text', content } });
    const note = openNote(view, api);
    note.edit('');
    view.renderTaskList(api, list, view.mainListArea, view.mainDetail);
    assert.equal(note.value(), '');
    await note.save();
    view.currentTasks = [{ ...task, body: { contentType: 'text', content: 'Edited elsewhere' } }];
    view.renderTaskList(api, list, view.mainListArea, view.mainDetail);
    assert.equal(note.value(), 'Edited elsewhere');
});

test('a refresh from a previous visit cannot overwrite the current view', async () => {
    const { view, api } = setup();
    const response = deferred();
    api.getTasks = () => response.promise;
    const refreshing = view.refreshCachedList(api, list, view.mainListArea, view.mainDetail);
    view.viewTransitionToken++;
    const current = [{ ...task, title: 'Current view' }];
    view.currentTasks = current;
    response.resolve([task]);
    await refreshing;
    assert.equal(view.currentTasks, current);
});

test('smart-view refresh and completed-task preload leave active search results alone', async () => {
    for (const operation of ['smart', 'completed']) {
        const { view, api } = setup();
        view.selectedListId = '__my-day__';
        const response = deferred();
        api.getTasks = () => response.promise;
        view.taskCache.get(list.id).allLoaded = false;
        const refreshing = operation === 'smart'
            ? view.refreshSmartViewInBackground(api, [list], '__my-day__', list, view.mainListArea, view.mainDetail)
            : view.preloadCompletedData(api, list);
        view.searchQuery = 'needle';
        const results = view.currentTasks;
        response.resolve([task]);
        await refreshing;
        assert.equal(view.currentTasks, results, operation);
    }
});

test('closing search cancels the pending debounce and restores the selected list', async () => {
    const { view, api, timers } = setup();
    const host = new Element();
    view.renderSearchBar(api, host, new Element(), [list]);
    view.searchToggleFn();
    const input = host.querySelector('.todo-search-input');
    let restored = false;
    view.loadTaskList = async () => { restored = true; };
    input.value = 'needle';
    input.emit('input');
    input.emit('keydown', { key: 'Escape', preventDefault() {} });
    for (const callback of timers.values()) callback();
    assert.equal(view.searchQuery, '');
    assert.equal(input.value, '');
    assert.equal(restored, true);
});

test('a delayed search cannot overwrite the view selected afterward', async () => {
    const { view, api } = setup();
    const response = deferred();
    view.taskCache.clear();
    api.getTasks = () => response.promise;
    view.searchQuery = 'needle';
    const searching = view.runSearch(api, new Element(), [list]);
    view.clearSearchState();
    const current = [{ ...task, title: 'Different view' }];
    view.currentTasks = current;
    response.resolve([task]);
    await searching;
    assert.equal(view.currentTasks, current);
});

test('a current list refresh still updates the visible list', async () => {
    const { view, api } = setup();
    api.getTasks = async () => [{ ...task, title: 'Updated remotely' }];
    await view.refreshCachedList(api, list, view.mainListArea, view.mainDetail);
    assert.equal(view.currentTasks[0].title, 'Updated remotely');
    assert.equal(view.mainListArea.querySelector('.todo-task-title').text, 'Updated remotely');
});

test('quick capture can retry an actual creation failure', async () => {
    const { QuickCaptureModal, plugin, api, view } = setup();
    const modal = new QuickCaptureModal({}, plugin, api, [list], list.id);
    modal.titleInput = { value: 'Quick task' };
    modal.listSelect = { value: list.id };
    modal.todayToggle = { checked: false };
    modal.confirmButton = new Element();
    api.createTask = async () => { throw new Error('Creation failed'); };
    await modal.submit();
    assert.equal(modal.submitting, false);
    assert.equal(modal.confirmButton.disabled, false);
    api.createTask = async () => ({ ...task, id: 'created' });
    await modal.submit();
    assert.equal(modal.closed, true);
    assert(view.taskCache.get(list.id).tasks.some(item => item.id === 'created'));
});
