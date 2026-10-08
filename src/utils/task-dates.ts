import type { TodoTask } from '../api/ms-todo-api';
import { t, getLocale } from '../i18n';

type MetaKind = 'today' | 'tomorrow' | 'overdue' | 'date' | 'completed';

interface TaskMeta {
    text: string;
    kind: MetaKind;
}

export function buildTaskMeta(task: TodoTask): TaskMeta | null {
    if (task.status === 'completed') {
        const completedDate = task.completedDateTime?.dateTime;
        return {
            text: completedDate ? formatFriendlyDate(completedDate) : t('date.completed'),
            kind: 'completed',
        };
    }

    const due = dateToInputValue(task.dueDateTime?.dateTime || '');
    if (!due) return null;

    const today = toLocalDateKey(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = toLocalDateKey(tomorrowDate);

    if (due === today) return { text: t('date.today'), kind: 'today' };
    if (due === tomorrow) return { text: t('date.tomorrow'), kind: 'tomorrow' };
    if (due < today) return { text: t('date.overdueWithDate', { date: formatShortDate(due) }), kind: 'overdue' };
    return { text: formatShortDate(due), kind: 'date' };
}

export function isTaskDueOn(task: TodoTask, dateKey: string): boolean {
    return dateToInputValue(task.dueDateTime?.dateTime || '') === dateKey;
}

export function isTaskOverdue(task: TodoTask, today: string): boolean {
    const due = dateToInputValue(task.dueDateTime?.dateTime || '');
    return !!due && due < today;
}

export function toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function dateToInputValue(value: string): string {
    if (!value) return '';
    return value.includes('T') ? (value.split('T')[0] || '') : value;
}

export function formatShortDate(value: string): string {
    return formatCalendarDate(value, { month: 'short', day: 'numeric' });
}

export function formatFriendlyDate(value: string): string {
    const date = dateToInputValue(value);
    if (!date) return value;

    const today = toLocalDateKey(new Date());
    if (date === today) return t('date.today');
    return formatShortDate(date);
}

export function formatDisplayDate(value: string): string {
    return formatCalendarDate(value, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions): string {
    const key = dateToInputValue(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) return value;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (toLocalDateKey(date) !== key) return value;
    return new Intl.DateTimeFormat(getLocale(), options).format(date);
}
