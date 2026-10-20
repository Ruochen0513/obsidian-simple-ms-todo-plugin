const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, Element, list, task } = require('./helpers.cjs');

const dated = (id, date, extra = {}) => ({ ...task, id, dueDateTime: { dateTime: `${date}T00:00:00`, timeZone: 'UTC' }, ...extra });
const ids = items => Array.from(items, item => item.id);

test('planned groups cross a year boundary and exclude undated and completed tasks', () => {
    const { groupPlannedTasks } = setup();
    const groups = groupPlannedTasks([
        dated('later-last', '2027-02-01'), dated('today', '2026-12-31'),
        dated('tomorrow', '2027-01-01'), dated('earlier', '2026-12-30'),
        dated('later-first', '2027-01-02'), dated('done', '2026-12-31', { status: 'completed' }), task,
        { ...task, id: 'disabled-reminder', isReminderOn: false, reminderDateTime: { dateTime: '2027-01-01T09:00:00' } },
    ], new Date(2026, 11, 31, 12));
    assert.deepEqual(ids(groups.today), ['today']);
    assert.deepEqual(ids(groups.tomorrow), ['tomorrow']);
    assert.deepEqual(ids(groups.earlier), ['earlier']);
    assert.deepEqual(ids(groups.later), ['later-first', 'later-last']);
});

test('enabled reminders count as plans and UTC reminders use the device calendar date', () => {
    const { getPlannedDate, isPlannedTask } = setup();
    const value = '2026-12-31T23:30:00';
    const local = new Date(`${value}Z`);
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    const reminder = { ...task, isReminderOn: true, reminderDateTime: { dateTime: value, timeZone: 'UTC' } };
    assert.equal(isPlannedTask(reminder), true);
    assert.equal(getPlannedDate(reminder), expected);
    assert.equal(getPlannedDate({ ...reminder, dueDateTime: { dateTime: '2027-01-04T00:00:00' } }), '2027-01-04');
    assert.equal(isPlannedTask({ ...reminder, status: 'completed' }), false);
    assert.equal(isPlannedTask({ ...reminder, reminderDateTime: { dateTime: 'invalid', timeZone: 'UTC' } }), false);
});

test('older plans are collapsed and past reminders are not described as overdue', () => {
    const { view, api } = setup();
    view.selectedListId = '__planned__';
    view.currentTasks = [dated('future', '2099-01-01'), dated('overdue', '2000-01-01'), {
        ...task, id: 'old-reminder', isReminderOn: true, reminderDateTime: { dateTime: '2000-01-02T09:00:00', timeZone: 'UTC' },
    }];
    view.currentTasks.forEach(item => view.taskListByTaskId.set(item.id, list));
    view.renderTaskList(api, null, view.mainListArea, view.mainDetail);
    assert.equal(view.mainListArea.querySelectorAll('.todo-task-row').length, 1);
    const toggle = view.mainListArea.querySelector('.todo-earlier-toggle');
    assert.equal(toggle.attrs['aria-expanded'], 'false');
    assert.match(toggle.children[1].text, /Earlier.*2/);
    toggle.onclick();
    assert.equal(view.mainListArea.querySelectorAll('.todo-task-row').length, 3);
    assert.equal(view.mainListArea.querySelector('.todo-earlier-toggle').attrs['aria-expanded'], 'true');
});

test('planned fetches active tasks first and completed history loads only when opened', async () => {
    const { view, api } = setup();
    const calls = [];
    view.taskCache.clear();
    view.selectedListId = '__planned__';
    api.getTasks = async (_id, includeCompleted) => {
        calls.push(includeCompleted);
        return [dated('active', '2099-01-01'), ...(includeCompleted ? [{ ...task, id: 'done', status: 'completed' }] : [])];
    };
    await view.loadPlannedView(api, new Element(), [list]);
    assert.deepEqual(calls, [false]);
    assert.deepEqual(ids(view.currentTasks), ['active']);
    view.selectedListId = '__completed__';
    await view.loadCompletedView(api, new Element(), [list]);
    assert.deepEqual(calls, [false, true]);
    assert.deepEqual(ids(view.currentTasks), ['done']);
    assert.equal(view.mainListArea.querySelector('.todo-task-group-heading').text, list.displayName);
    view.selectedListId = list.id;
    await view.loadTaskList(api, new Element(), list);
    assert.equal(view.mainListArea.querySelectorAll('.todo-task-row').length, 1);
    assert.equal(view.mainListArea.querySelector('.todo-task-row').attrs['data-task-id'], 'active');
});

test('failed completion and reopening restore tasks to their respective smart views', async () => {
    for (const completed of [false, true]) {
        const { view, api } = setup();
        const original = dated('edited', '2099-01-01', { status: completed ? 'completed' : 'notStarted' });
        view.selectedListId = completed ? '__completed__' : '__planned__';
        view.currentTasks = [original];
        view.taskListByTaskId.set(original.id, list);
        api.completeTask = api.reopenTask = async () => { throw new Error('Offline'); };
        await view.toggleTaskCompletionOptimistically(api, list, view.mainListArea, view.mainDetail, original);
        assert.deepEqual(ids(view.currentTasks), ['edited']);
        assert.equal(view.currentTasks[0].status, original.status);
        assert.equal(view.mainListArea.querySelectorAll('.todo-task-row').length, 1);
    }
});

test('Completed is last in the view selector and search still shows source lists', () => {
    const { view, api } = setup();
    const host = new Element();
    view.renderViewSelector(api, host, [list], new Element());
    const items = host.querySelectorAll('.todo-list-menu-item');
    assert.equal(items[0].attrs['data-view-id'], '__planned__');
    assert.equal(items.at(-1).attrs['data-view-id'], '__completed__');
    assert(items.at(-1).hasClass('todo-list-menu-secondary'));
    view.selectedListId = '__completed__';
    view.searchQuery = 'needle';
    view.taskListByTaskId.set(task.id, list);
    view.renderTaskList(api, null, view.mainListArea, view.mainDetail);
    assert.equal(view.mainListArea.querySelector('.todo-task-source').text, list.displayName);
});

test('clearing the due date removes a task from Planned without leaving a selected detail', async () => {
    const { view, api } = setup();
    const original = dated(task.id, '2099-01-01');
    view.selectedListId = '__planned__';
    view.currentTasks = [original];
    view.selectedTaskId = original.id;
    await view.saveTaskChange(api, list, view.mainListArea, view.mainDetail, original, async () => task, 'Saved');
    assert.equal(view.currentTasks.length, 0);
    assert.equal(view.selectedTaskId, null);
    assert.equal(view.taskCache.get(list.id).tasks[0].id, task.id);
});

test('quick capture adds future plans immediately and keeps undated tasks in their list', async () => {
    for (const date of ['', '2099-01-01']) {
        const { QuickCaptureModal, plugin, view, api } = setup();
        view.selectedListId = '__planned__';
        view.currentTasks = [];
        const modal = new QuickCaptureModal({}, plugin, api, [list], list.id);
        modal.titleInput = { value: 'New plan' };
        modal.listSelect = { value: list.id };
        modal.dueDateInput = { value: date };
        modal.confirmButton = new Element();
        api.createTask = async () => ({ ...task, id: 'new', title: 'New plan' });
        api.updateTaskDueDate = async (_list, id, due) => {
            assert.equal(due, date);
            return dated(id, due);
        };
        await modal.submit();
        assert.equal(modal.closed, true);
        assert.deepEqual(ids(view.currentTasks), date ? ['new'] : []);
        assert(view.taskCache.get(list.id).tasks.some(item => item.id === 'new'));
    }
});

test('quick capture ignores Enter while Chinese input is composing', () => {
    const { QuickCaptureModal, plugin, api } = setup();
    const modal = new QuickCaptureModal({}, plugin, api, [list], list.id);
    modal.titleEl = new Element();
    modal.contentEl = new Element();
    let submissions = 0;
    modal.submit = async () => { submissions++; };
    modal.onOpen();
    modal.titleInput.emit('keydown', { key: 'Enter', isComposing: true });
    assert.equal(submissions, 0);
    modal.titleInput.emit('keydown', { key: 'Enter', isComposing: false, preventDefault() {} });
    assert.equal(submissions, 1);
});
