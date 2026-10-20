import type { TodoTask } from '../api/ms-todo-api';
import { dateToInputValue, toLocalDateKey } from './task-dates';
import { parseReminderDate } from './reminder-date';

export function getPlannedDate(task: TodoTask): string {
    const due = dateToInputValue(task.dueDateTime?.dateTime || '');
    if (due) return due;
    const reminder = task.isReminderOn ? task.reminderDateTime : undefined;
    if (!reminder?.dateTime) return '';
    const date = parseReminderDate(reminder);
    return date ? toLocalDateKey(date) : '';
}

export function isPlannedTask(task: TodoTask): boolean {
    return task.status !== 'completed' && !!getPlannedDate(task);
}

export function groupPlannedTasks(tasks: TodoTask[], now = new Date()) {
    const today = toLocalDateKey(now);
    const nextDay = new Date(now);
    nextDay.setDate(nextDay.getDate() + 1);
    const tomorrow = toLocalDateKey(nextDay);
    const groups: Record<'today' | 'tomorrow' | 'later' | 'earlier', TodoTask[]> = {
        today: [], tomorrow: [], later: [], earlier: [],
    };
    const sorted = tasks.filter(isPlannedTask).sort((a, b) =>
        getPlannedDate(a).localeCompare(getPlannedDate(b)) ||
        Number(b.importance === 'high') - Number(a.importance === 'high'));
    for (const task of sorted) {
        const date = getPlannedDate(task);
        const group = date < today ? 'earlier' : date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'later';
        groups[group].push(task);
    }
    return groups;
}
