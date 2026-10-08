const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, Element, list, task } = require('./helpers.cjs');

test('Escape dismisses the calendar and releases its keyboard scope without changing the date', () => {
    const { attachDatePicker, plugin, pickers, scopes } = setup();
    const input = new Element();
    input.value = '2026-10-20';
    const dispose = attachDatePicker(plugin.app, plugin, input);
    const picker = pickers[0];
    picker.open();
    assert.equal(input.attrs['aria-expanded'], 'true');
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].handlers.find(h => h.key === 'Escape').callback(), false);
    assert.equal(picker.isOpen, false);
    assert.equal(input.value, '2026-10-20');
    assert.equal(scopes.length, 0);
    dispose();
    assert.equal(picker.destroyed, true);
    assert.equal(plugin.children.length, 0);
});

test('refreshing or leaving task details disposes its calendar and document listeners', () => {
    const { view, api, pickers, scopes } = setup();
    view.selectTask(api, list, view.mainListArea, view.mainDetail, task);
    pickers[0].open();
    view.renderTaskList(api, list, view.mainListArea, view.mainDetail);
    assert.equal(pickers[0].destroyed, true);
    assert.equal(scopes.length, 0);
    assert.equal(view.children.length, 2);
    view.mainDetail.querySelector('.todo-detail-close').onclick();
    assert.equal(pickers[1].destroyed, true);
    assert.equal(view.children.length, 0);
});

test('closing quick capture or unloading the plugin disposes an open calendar', () => {
    for (const unload of [false, true]) {
        const { QuickCaptureModal, plugin, api, pickers, scopes } = setup();
        const modal = new QuickCaptureModal(plugin.app, plugin, api, [list], list.id);
        modal.titleEl = new Element();
        modal.contentEl = new Element();
        modal.onOpen();
        pickers[0].open();
        if (unload) plugin.unload();
        else modal.close();
        assert.equal(pickers[0].destroyed, true);
        assert.equal(scopes.length, 0);
    }
});
