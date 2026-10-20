import { setIcon, Notice } from 'obsidian';
import type { TodoView } from './todo-view';
import type { MsTodoApi, TodoList, TodoTask } from '../api/ms-todo-api';
import { t } from '../i18n';
import { taskBodyText } from '../utils/task-body';
import { dateToInputValue, toLocalDateKey, formatDisplayDate } from '../utils/task-dates';
import { attachDatePicker } from './date-picker';
import { renderTaskSteps } from './task-steps';

export function renderTaskDetail(view: TodoView, api: MsTodoApi, detail: HTMLElement, listArea: HTMLElement, list: TodoList, task: TodoTask, noteDrafts: Map<string, string>) {
    view.clearDetailControls();
    detail.empty();
    detail.addClass('is-open');

    const topbar = detail.createDiv({ cls: 'todo-detail-topbar' });
    const closeBtn = topbar.createEl('button', { cls: 'todo-detail-close' });
    closeBtn.setAttr('type', 'button');
    closeBtn.setAttr('aria-label', t('taskDetail.backAria'));
    setIcon(closeBtn, 'arrow-left');
    closeBtn.createSpan({ text: t('taskDetail.backAria'), cls: 'todo-detail-topbar-title' });

    closeBtn.onclick = () => {
        view.clearDetailControls();
        view.selectedTaskId = null;
        detail.empty();
        detail.removeClass('is-open');
        listArea.querySelectorAll('.todo-task-row').forEach((row) => row.removeClass('is-selected'));
    };

    const header = detail.createDiv({ cls: 'todo-detail-header' });
    const complete = header.createEl('input', { type: 'checkbox', cls: 'todo-task-checkbox' });
    complete.checked = task.status === 'completed';
    complete.setAttr('aria-label', task.status === 'completed' ? t('taskRow.reopenAria') : t('taskRow.completeAria'));
    complete.onchange = () => {
        void view.toggleTaskCompletionOptimistically(api, list, listArea, detail, task);
    };

    const titleInput = header.createEl('input', { type: 'text', cls: 'todo-title-input' });
    titleInput.value = task.title;
    const originalTitle = titleInput.value.trim();
    titleInput.setAttr('title', task.title);
    titleInput.setAttr('aria-label', t('taskDetail.taskName'));
    titleInput.onkeydown = (event) => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            titleInput.blur();
        }
    };
    titleInput.onblur = () => {
        const nextTitle = titleInput.value.trim();
        if (!nextTitle || nextTitle === originalTitle) return;
        void view.saveTaskChange(
            api,
            list,
            listArea,
            detail,
            task,
            () => api.updateTask(list.id, task.id, { title: nextTitle }),
            t('taskDetail.titleUpdated'),
        );
    };

    const starBtn = header.createEl('button', { cls: 'todo-star-button' });
    starBtn.setAttr('type', 'button');
    starBtn.setAttr('aria-label', task.importance === 'high' ? t('taskDetail.removeImportantAria') : t('taskDetail.markImportantAria'));
    starBtn.setAttr('aria-pressed', String(task.importance === 'high'));
    setIcon(starBtn, 'star');
    if (task.importance === 'high') starBtn.addClass('is-important');
    starBtn.onclick = () => {
        void view.saveTaskChange(
            api,
            list,
            listArea,
            detail,
            task,
            () => api.toggleImportant(list.id, task),
            task.importance === 'high' ? t('taskDetail.removedFromImportant') : t('taskDetail.markedAsImportant'),
        );
    };

    renderTaskSteps(view, api, detail, listArea, list, task);

    const dateCard = detail.createDiv({ cls: 'todo-detail-card' });
    const dateLabel = dateCard.createDiv({ cls: 'todo-detail-card-label' });
    const dateLabelIcon = dateLabel.createSpan();
    setIcon(dateLabelIcon, 'calendar-days');
    dateLabel.createSpan({ text: t('taskDetail.dueDateLabel') });
    const dateControl = dateCard.createDiv({ cls: 'todo-date-control' });
    const dateInput = dateControl.createEl('input', { type: 'date', cls: 'todo-date-input' });
    dateInput.setAttr('aria-label', t('taskDetail.dueDateLabel'));
    dateInput.value = dateToInputValue(task.dueDateTime?.dateTime || '');
    dateInput.onchange = () => {
        void view.saveTaskChange(
            api,
            list,
            listArea,
            detail,
            task,
            () => api.updateTaskDueDate(list.id, task.id, dateInput.value),
            dateInput.value ? t('taskDetail.dueDateUpdated') : t('taskDetail.dueDateCleared'),
        );
    };
    view.disposeDetailDatePicker = attachDatePicker(view.plugin.app, view, dateInput, view.scope);
    if (task.dueDateTime?.dateTime) {
        const clearDate = dateControl.createEl('button', { cls: 'todo-clear-date' });
        clearDate.setAttr('type', 'button');
        clearDate.setAttr('aria-label', t('taskDetail.clearDate'));
        clearDate.setAttr('title', t('taskDetail.clearDate'));
        setIcon(clearDate, 'x');
        clearDate.onclick = () => {
            void view.saveTaskChange(
                api,
                list,
                listArea,
                detail,
                task,
                () => api.updateTaskDueDate(list.id, task.id, ''),
                t('taskDetail.dueDateCleared'),
            );
        };
    }

    const chipsRow = dateCard.createDiv({ cls: 'todo-date-chips' });
    const currentDue = dateToInputValue(task.dueDateTime?.dateTime || '');
    const dateChips: Array<{ label: string; days: number }> = [
        { label: t('taskDetail.chipToday'), days: 0 },
        { label: t('taskDetail.chipTomorrow'), days: 1 },
        { label: t('taskDetail.chipNextWeek'), days: 7 },
    ];
    dateChips.forEach((chip) => {
        const getDateKey = () => {
            const date = new Date();
            date.setDate(date.getDate() + chip.days);
            return toLocalDateKey(date);
        };
        const chipKey = getDateKey();
        const chipBtn = chipsRow.createEl('button', { text: chip.label, cls: 'todo-date-chip' });
        chipBtn.setAttr('type', 'button');
        chipBtn.setAttr('aria-label', t('taskDetail.setDueDateAria', { label: chip.label }));
        chipBtn.setAttr('aria-pressed', String(currentDue === chipKey));
        if (currentDue === chipKey) chipBtn.addClass('is-active');
        chipBtn.onclick = () => {
            void view.saveTaskChange(
                api,
                list,
                listArea,
                detail,
                task,
                () => api.updateTaskDueDate(list.id, task.id, getDateKey()),
                t('taskDetail.dueDateSetTo', { label: chip.label }),
            );
        };
    });

    const noteCard = detail.createDiv({ cls: 'todo-detail-card' });
    const noteLabel = noteCard.createDiv({ cls: 'todo-detail-card-label' });
    const noteLabelIcon = noteLabel.createSpan();
    setIcon(noteLabelIcon, 'notebook-pen');
    noteLabel.createSpan({ text: t('taskDetail.notesLabel') });
    const noteInput = noteCard.createEl('textarea', { cls: 'todo-note-input' });
    noteInput.setAttr('placeholder', t('taskDetail.notePlaceholder'));
    noteInput.setAttr('aria-label', t('taskDetail.notesLabel'));
    noteInput.value = noteDrafts.get(task.id) ?? taskBodyText(task.body);
    noteInput.addEventListener('input', () => {
        noteDrafts.set(task.id, noteInput.value);
    });
    noteInput.rows = 3;
    const saveNote = noteLabel.createEl('button', { text: t('taskDetail.saveNote'), cls: 'todo-save-note' });
    saveNote.setAttr('type', 'button');
    saveNote.onclick = () => {
        const content = noteInput.value;
        void view.saveTaskChange(
            api,
            list,
            listArea,
            detail,
            task,
            async () => {
                const updated = await api.updateTaskBody(list.id, task.id, content);
                if (api.isCurrentSession() && noteDrafts.get(task.id) === content) noteDrafts.delete(task.id);
                return updated;
            },
            t('taskDetail.noteUpdated'),
        );
    };

    const footer = detail.createDiv({ cls: 'todo-detail-footer' });
    const footerMeta = footer.createDiv({ cls: 'todo-detail-footer-meta' });
    if (task.createdDateTime) footerMeta.createSpan({ text: t('taskDetail.createdAt', { date: formatDisplayDate(task.createdDateTime) }) });
    if (task.completedDateTime?.dateTime) footerMeta.createSpan({ text: t('taskDetail.completedAt', { date: formatDisplayDate(task.completedDateTime.dateTime) }) });

    const deleteButton = footer.createEl('button', { cls: 'todo-delete-task-button' });
    deleteButton.setAttr('type', 'button');
    deleteButton.setAttr('aria-label', t('taskDetail.deleteTaskAria', { taskTitle: task.title }));
    const deleteIcon = deleteButton.createSpan({ cls: 'todo-delete-task-icon' });
    setIcon(deleteIcon, 'trash-2');
    deleteButton.createSpan({ text: t('taskDetail.deleteTask') });
    deleteButton.onclick = () => {
        void view.confirmAndDeleteTask(api, list, listArea, detail, task);
    };
}
