const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, deferred, Element, list } = require('./helpers.cjs');
const settled = () => new Promise(resolve => setImmediate(resolve));

function menu(view, api) {
    const host = new Element();
    view.renderViewSelector(api, host, view.currentLists, new Element());
    host.querySelector('.todo-view-selector').onclick({ stopPropagation() {} });
    const trigger = host.querySelector('.todo-list-menu-create');
    trigger.onclick();
    return { host, trigger, input: host.querySelector('.todo-list-create-input'), row: host.querySelector('.todo-list-create-row') };
}
function enter(input, extra = {}) { input.onkeydown({ key: 'Enter', preventDefault() {}, ...extra }); }

test('inline list creation updates the open selector and leaves the current view until its normal list item is selected', async () => {
    const { view, api } = setup();
    const before = view.selectedListId;
    view.selectedTaskId = 'existing-task';
    view.showEarlier = true;
    api.createTaskList = async name => ({ id: 'created-list', displayName: name });
    const { host, trigger, input, row } = menu(view, api);
    input.value = '  A new list  ';
    enter(input);
    await settled();
    assert.equal(view.selectedListId, before);
    assert.equal(view.selectedTaskId, 'existing-task');
    assert.equal(view.showEarlier, true);
    assert.equal(row.hidden, true);
    assert.equal(trigger.hidden, false);
    assert.equal(host.querySelector('.todo-view-selector-wrap').hasClass('is-open'), true);
    assert.equal(host.querySelector('.todo-list-created'), null);
    assert.equal(view.currentLists.at(-1).displayName, 'A new list');
    assert.equal(view.taskCache.get('created-list').tasks.length, 0);
    const item = host.querySelectorAll('.todo-list-menu-item').find(el => el.attrs['data-list-id'] === 'created-list');
    assert(item);
    item.onclick();
    assert.equal(view.selectedListId, 'created-list');
    assert.equal(view.selectedTaskId, null);
    assert.equal(host.querySelector('.todo-view-selector-wrap').hasClass('is-open'), false);
    assert.equal(host.querySelector('.todo-view-selector-label').text, 'A new list');
});

test('new list ignores IME, empty and overlong names, blocks duplicates and preserves a failed draft', async () => {
    const { view, api } = setup();
    const response = deferred();
    let calls = 0;
    api.createTaskList = () => { calls++; return response.promise; };
    const { input, row } = menu(view, api);
    input.value = ' '; enter(input);
    input.value = 'x'.repeat(65); enter(input);
    input.value = '中文清单';
    enter(input, { isComposing: true });
    enter(input, { keyCode: 229 });
    assert.equal(calls, 0);
    enter(input); enter(input);
    assert.equal(calls, 1);
    assert.equal(input.readOnly, true);
    response.reject(new Error('Offline'));
    await settled();
    assert.equal(input.value, '中文清单');
    assert.equal(input.readOnly, false);
    assert.equal(row.hidden, false);
    assert.equal(view.currentLists.length, 1);
    api.createTaskList = async name => ({ id: 'retry', displayName: name });
    enter(input); await settled();
    assert.equal(view.currentLists.at(-1).id, 'retry');
});

test('closing and reopening the selector keeps a list draft; Escape cancels without creating', () => {
    const { view, api } = setup();
    api.createTaskList = () => assert.fail('Should not create');
    const { host, trigger, input, row } = menu(view, api);
    input.value = 'Draft';
    const selector = host.querySelector('.todo-view-selector');
    selector.onclick({ stopPropagation() {} });
    selector.onclick({ stopPropagation() {} });
    assert.equal(host.querySelector('.todo-list-create-input'), input);
    assert.equal(input.value, 'Draft');
    input.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(input.value, '');
    assert.equal(row.hidden, true);
    assert.equal(trigger.hidden, false);
});

test('an old list creation response cannot restore a signed-out account', async () => {
    const { view, api, plugin, notices } = setup();
    const response = deferred();
    api.createTaskList = () => response.promise;
    const { input } = menu(view, api);
    input.value = 'Old account'; enter(input);
    plugin.session.signOut(); await view.render();
    response.resolve({ id: 'old-list', displayName: 'Old account' });
    await settled();
    assert.equal(view.currentLists.length, 0);
    assert.equal(view.taskCache.size, 0);
    assert.equal(notices.length, 0);
});

test('default view persists a list choice, initializes fresh sidebars, and falls back when the list is missing', async () => {
    const { plugin, TodoView, readSettings } = setup();
    for (const invalid of [null, 42, '', ' ', '__completed__', ' __completed__ ']) {
        assert.equal(readSettings({ defaultViewId: invalid }).defaultViewId, '__planned__');
    }
    plugin.settings = readSettings({ defaultViewId: ' ' + list.id + ' ' });
    await plugin.saveSettings();
    assert.equal(plugin.saved.defaultViewId, list.id);
    const view = new TodoView({}, plugin);
    assert.equal(view.selectedListId, list.id);
    view.normalizeSelectedView([list]);
    assert.equal(view.selectedListId, list.id);
    view.normalizeSelectedView([]);
    assert.equal(view.selectedListId, '__planned__');
    assert.equal(plugin.settings.defaultViewId, list.id);
});
