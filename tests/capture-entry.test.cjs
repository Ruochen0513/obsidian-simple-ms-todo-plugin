const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, Element, list, task } = require('./helpers.cjs');
const settled = () => new Promise(resolve => setImmediate(resolve));

async function mount(view, api) {
    view.loadTaskList = view.loadPlannedView = view.loadCompletedView = async () => {};
    const container = new Element();
    await view.renderShell(api, container, view.currentLists);
    const row = container.querySelector('.todo-capture-entry');
    return { row, input: row.querySelector('.todo-capture-input'), add: row.querySelector('.todo-capture-submit') };
}
function type(input, value) { input.value = value; input.oninput(); }
function enter(input, extra = {}) { input.onkeydown({ key: 'Enter', preventDefault() {}, ...extra }); }

test('sidebar Enter creates directly in the current list, or the default list in smart views, without a modal or date', async () => {
    for (const selected of ['other-list', '__planned__', '__completed__']) {
        const { view, api, QuickCaptureModal, notices } = setup();
        view.currentLists.push({ id: 'other-list', displayName: 'Other list' });
        view.selectedListId = selected;
        QuickCaptureModal.prototype.open = () => assert.fail('Sidebar must not open a modal');
        let destination;
        api.createTask = async (id, title) => {
            destination = id;
            assert.equal(title, 'New task');
            return { ...task, id: 'new', title };
        };
        const { row, input } = await mount(view, api);
        assert.equal(row.parentElement.children.at(-1), row);
        type(input, ' New task ');
        enter(input);
        await settled();
        assert.equal(destination, selected === 'other-list' ? selected : list.id);
        assert.equal(input.value, '');
        assert.equal(input.readOnly, false);
        const created = view.taskCache.get(destination).tasks.find(item => item.id === 'new');
        assert.equal(created.dueDateTime, undefined);
        assert.match(notices[0], /Added to/);
    }
});

test('inline capture ignores blank input, IME confirmation and repeat submissions', async () => {
    const { view, api } = setup();
    const request = deferred();
    let calls = 0;
    api.createTask = () => { calls++; return request.promise; };
    const { input, add } = await mount(view, api);
    type(input, '  '); enter(input);
    type(input, '中文任务');
    enter(input, { isComposing: true });
    enter(input, { keyCode: 229 });
    assert.equal(calls, 0);
    enter(input); enter(input); add.onclick();
    assert.equal(calls, 1);
    assert.equal(input.readOnly, true);
    assert.equal(add.disabled, true);
    request.resolve({ ...task, id: 'new' });
    await settled();
    assert.equal(input.readOnly, false);
    assert.equal(input.value, '');
});

test('failure keeps the draft for retry and refresh during a submission unlocks the new input', async () => {
    const { view, api, notices } = setup();
    const first = await mount(view, api);
    type(first.input, 'Keep this draft');
    api.createTask = async () => { throw new Error('Offline'); };
    enter(first.input);
    await settled();
    assert.equal(first.input.value, 'Keep this draft');
    assert.equal(first.input.readOnly, false);
    assert.match(notices[0], /Failed to add task/);
    const request = deferred();
    api.createTask = () => request.promise;
    enter(first.input);
    const refreshed = await mount(view, api);
    assert.equal(refreshed.input.value, 'Keep this draft');
    assert.equal(refreshed.input.readOnly, true);
    request.resolve({ ...task, id: 'retried' });
    await settled();
    assert.equal(refreshed.input.value, '');
    assert.equal(refreshed.input.readOnly, false);
    assert.equal(view.taskCache.get(list.id).tasks.filter(item => item.id === 'retried').length, 1);
});

test('switching lists preserves the draft and submits to the list visible at submission time', async () => {
    const { view, api } = setup();
    view.currentLists.push({ id: 'other-list', displayName: 'Other list' });
    const { input } = await mount(view, api);
    type(input, 'Draft');
    view.selectedListId = 'other-list';
    view.updateTaskComposer();
    assert.equal(input.value, 'Draft');
    assert.match(input.attrs.title, /Other list/);
    api.createTask = async id => {
        assert.equal(id, 'other-list');
        return { ...task, id: 'new' };
    };
    enter(input);
    await settled();
});

test('sign-out clears the draft and an old creation response cannot repopulate the cache', async () => {
    const { view, api, plugin, notices } = setup();
    const request = deferred();
    api.createTask = () => request.promise;
    const { input } = await mount(view, api);
    type(input, 'Private draft'); enter(input);
    plugin.session.signOut();
    await view.render();
    request.resolve({ ...task, id: 'old-account-task' });
    await settled();
    assert.equal(view.taskComposerDraft.value, '');
    assert.equal(view.updateTaskComposer, undefined);
    assert.equal(view.taskCache.size, 0);
    assert.equal(notices.length, 0);
});

test('the single input uses the assigned quick capture shortcut as its placeholder', async () => {
    const { view, plugin, api } = setup();
    let hotkey = 'Alt + N';
    plugin.app.hotkeyManager = { printHotkeyForCommand(id) {
        assert.equal(id, 'simple-microsoft-todo:quick-capture');
        return hotkey;
    } };
    const { row, input } = await mount(view, api);
    assert.equal(row.querySelector('.todo-capture-shortcut'), null);
    assert.equal(input.attrs.placeholder, 'Quick input Alt+N');
    type(input, 'Draft');
    assert.equal(input.value, 'Draft');
    type(input, '');
    hotkey = 'Ctrl + Shift + N'; input.onfocus();
    assert.equal(input.attrs.placeholder, 'Quick input Ctrl+Shift+N');
    hotkey = ''; row.onmouseenter();
    assert.equal(input.attrs.placeholder, 'Quick input');
});

test('Quick capture still opens without any sidebar view', async () => {
    const { plugin, MsTodoApi, QuickCaptureModal, openQuickCapture } = setup();
    plugin.getTodoView = () => null;
    MsTodoApi.prototype.getTaskLists = async () => [list];
    let modal;
    QuickCaptureModal.prototype.open = function () { modal = this; };
    await openQuickCapture(plugin);
    assert(modal instanceof QuickCaptureModal);
    assert.equal(modal.preferredListId, list.id);
});
