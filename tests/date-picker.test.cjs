const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, Element, list, task } = require('./helpers.cjs');

test('the date field toggles on repeated clicks without changing its value or leaking scopes', () => {
    const { attachDatePicker, plugin, pickers, scopes, frames } = setup();
    const input = new Element();
    input.value = '2026-10-20';
    const dispose = attachDatePicker(plugin.app, plugin, input);
    const picker = pickers[0];
    assert.equal(picker.config.clickOpens, false);
    for (const open of [true, false, true, false]) {
        input.emit('pointerdown');
        input.emit('click');
        assert.equal(picker.isOpen, open);
        assert.equal(input.attrs['aria-expanded'], String(open));
        assert.equal(scopes.length, Number(open));
        assert.equal(frames.size, Number(open));
        assert.equal(input.value, '2026-10-20');
    }
    dispose();
    input.emit('click');
    assert.equal(picker.isOpen, false);
});

test('Enter and Space toggle the calendar instantly without reaching Flatpickr activation twice', () => {
    const { attachDatePicker, plugin, pickers, frames } = setup();
    const input = new Element();
    attachDatePicker(plugin.app, plugin, input);
    for (const key of ['Enter', ' ']) {
        for (const open of [true, false]) {
            let prevented = false, stopped = false;
            input.emit('keydown', { key, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
            assert.equal(pickers[0].isOpen, open);
            assert(prevented && stopped);
            assert.equal(frames.size, 0);
        }
    }
});

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

test('pointer opening follows the final calendar placement and cancels animation on close', () => {
    const { attachDatePicker, plugin, pickers, frames } = setup();
    const input = new Element();
    attachDatePicker(plugin.app, plugin, input);
    const picker = pickers[0];
    input.emit('pointerdown');
    picker.open();
    picker.calendarContainer.addClass('arrowBottom');
    picker.calendarContainer.addClass('rightMost');
    const [id, animate] = [...frames][0];
    frames.delete(id);
    animate();
    const animation = picker.calendarContainer.animations[0];
    assert.equal(picker.calendarContainer.style.transformOrigin, 'right bottom');
    assert.match(animation.frames[0].transform, /translateY\(4px\)/);
    assert.equal(animation.options.duration, 160);
    picker.close();
    assert.equal(animation.cancelled, true);
});

test('quick close or disposal removes a queued opening animation and keyboard opening is immediate', () => {
    for (const disposeEarly of [false, true]) {
        const { attachDatePicker, plugin, pickers, frames } = setup();
        const input = new Element();
        const dispose = attachDatePicker(plugin.app, plugin, input);
        const picker = pickers[0];
        input.emit('pointerdown');
        picker.open();
        assert.equal(frames.size, 1);
        if (disposeEarly) dispose();
        else picker.close();
        assert.equal(frames.size, 0);
        assert.equal(picker.calendarContainer.animations.length, 0);
        if (!disposeEarly) {
            picker.open();
            assert.equal(frames.size, 0);
            assert.equal(picker.calendarContainer.animations.length, 0);
        }
    }
});

test('reduced-motion calendar opening fades without moving or scaling', () => {
    const { attachDatePicker, plugin, pickers, frames } = setup({ reducedMotion: true });
    const input = new Element();
    attachDatePicker(plugin.app, plugin, input);
    input.emit('pointerdown');
    pickers[0].open();
    [...frames.values()][0]();
    const animation = pickers[0].calendarContainer.animations[0];
    assert.equal(animation.frames[0].opacity, 0);
    assert.equal(animation.frames[1].opacity, 1);
    assert.equal(animation.frames.some(frame => 'transform' in frame), false);
});
