import { setIcon, Notice } from 'obsidian';
import type { TodoView } from './todo-view';
import type { MsTodoApi, TodoList, TodoTask, ChecklistItem } from '../api/ms-todo-api';
import { t } from '../i18n';
import { taskBodyText } from '../utils/task-body';
import { dateToInputValue, toLocalDateKey, formatDisplayDate } from '../utils/task-dates';

export function renderTaskDetail(view: TodoView, api: MsTodoApi, detail: HTMLElement, listArea: HTMLElement, list: TodoList, task: TodoTask, noteDrafts: Map<string, string>) {
    detail.empty();
    detail.addClass('is-open');

    const topbar = detail.createDiv({ cls: 'todo-detail-topbar' });
    const closeBtn = topbar.createEl('button', { cls: 'todo-detail-close' });
    closeBtn.setAttr('type', 'button');
    closeBtn.setAttr('aria-label', t('taskDetail.backAria'));
    setIcon(closeBtn, 'arrow-left');
    closeBtn.createSpan({ text: t('taskDetail.backAria'), cls: 'todo-detail-topbar-title' });

    closeBtn.onclick = () => {
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

    const titleInput = header.createEl('textarea', { cls: 'todo-title-input' });
    titleInput.value = task.title;
    titleInput.rows = 1;
    titleInput.setAttr('aria-label', t('taskDetail.taskName'));
    titleInput.onblur = () => {
        const nextTitle = titleInput.value.trim();
        if (!nextTitle || nextTitle === task.title) return;
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

    const stepsCard = detail.createDiv({ cls: 'todo-detail-card' });
    const stepsLabel = stepsCard.createDiv({ cls: 'todo-detail-card-label' });
    const stepsLabelIcon = stepsLabel.createSpan();
    setIcon(stepsLabelIcon, 'list-checks');
    stepsLabel.createSpan({ text: t('taskDetail.stepsLabel') });
    const checklistItems = task.checklistItems || [];
    if (checklistItems.length > 0) {
        const doneCount = checklistItems.filter((item) => item.isChecked).length;
        stepsLabel.createSpan({ text: `${doneCount}/${checklistItems.length}`, cls: 'todo-detail-card-count' });
    }

    const refocusStepInput = () => {
        window.setTimeout(() => {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            const nextInput = detail.querySelector('.todo-step-add-input');
            if (nextInput instanceof HTMLInputElement) nextInput.focus();
        }, 0);
    };

    const runChecklistMutation = (
        stepId: string,
        op: () => Promise<unknown>,
        applyLocal: () => void,
        rollback: () => void,
        failMessage: string,
        afterSuccess?: () => void,
    ) => {
        const key = `${task.id}:${stepId}`;
        if (!api.isCurrentSession() || view.pendingChecklistItemIds.has(key)) return;
        view.pendingChecklistItemIds.add(key);
        applyLocal();
        view.renderTaskList(api, list, listArea, detail);
        void (async () => {
            let succeeded = false;
            try {
                await op();
                if (!api.isCurrentSession()) return;
                view.markTaskRecentlyMutated(task.id);
                afterSuccess?.();
                succeeded = true;
            } catch (error) {
                if (!api.isCurrentSession()) return;
                rollback();
                new Notice(failMessage);
                console.error(error);
            } finally {
                if (api.isCurrentSession()) {
                    view.pendingChecklistItemIds.delete(key);
                    view.scheduleCachePersist();
                    if (!succeeded || afterSuccess) {
                        view.renderTaskList(api, list, listArea, detail);
                        if (afterSuccess) refocusStepInput();
                    } else {
                        // Unlock the current controls without discarding text being edited.
                        detail.querySelectorAll<HTMLElement>('.todo-step-row').forEach((row) => {
                            if (row.getAttr('data-step-id') !== stepId) return;
                            const checkbox = row.querySelector<HTMLInputElement>('.todo-step-checkbox');
                            const remove = row.querySelector<HTMLButtonElement>('.todo-step-remove');
                            if (checkbox) checkbox.disabled = false;
                            if (remove) remove.disabled = false;
                        });
                    }
                }
            }
        })();
    };

    checklistItems.forEach((step) => {
        const pending = view.pendingChecklistItemIds.has(`${task.id}:${step.id}`);
        const stepRow = stepsCard.createDiv({ cls: 'todo-step-row' });
        stepRow.setAttr('data-step-id', step.id);
        const checked = stepRow.createEl('input', { type: 'checkbox', cls: 'todo-step-checkbox' });
        checked.checked = step.isChecked;
        checked.disabled = pending;
        checked.setAttr('aria-label', step.isChecked ? t('taskDetail.reopenStepAria', { stepName: step.displayName }) : t('taskDetail.completeStepAria', { stepName: step.displayName }));
        const stepLabel = stepRow.createSpan({ text: step.displayName, cls: 'todo-step-label' });
        if (step.isChecked) stepLabel.addClass('is-checked');
        const removeBtn = stepRow.createEl('button', { cls: 'todo-step-remove' });
        removeBtn.disabled = pending;
        removeBtn.setAttr('type', 'button');
        removeBtn.setAttr('aria-label', t('taskDetail.deleteStepAria', { stepName: step.displayName }));
        const removeIcon = removeBtn.createSpan();
        setIcon(removeIcon, 'x');

        checked.onchange = () => {
            const nextChecked = checked.checked;
            runChecklistMutation(
                step.id,
                () => api.updateChecklistItem(list.id, task.id, step.id, { isChecked: nextChecked }),
                () => {
                    task.checklistItems = (task.checklistItems || []).map((item) =>
                        item.id === step.id ? { ...item, isChecked: nextChecked } : item);
                },
                () => {
                    task.checklistItems = (task.checklistItems || []).map((item) =>
                        item.id === step.id ? { ...item, isChecked: step.isChecked } : item);
                },
                t('taskDetail.updateStepFailed'),
            );
        };

        removeBtn.onclick = () => {
            const previousIndex = (task.checklistItems || []).findIndex((item) => item.id === step.id);
            runChecklistMutation(
                step.id,
                () => api.deleteChecklistItem(list.id, task.id, step.id),
                () => {
                    task.checklistItems = (task.checklistItems || []).filter((item) => item.id !== step.id);
                },
                () => {
                    const items = [...(task.checklistItems || [])];
                    if (!items.some((item) => item.id === step.id)) items.splice(previousIndex, 0, step);
                    task.checklistItems = items;
                },
                t('taskDetail.deleteStepFailed'),
            );
        };
    });

    const stepComposer = stepsCard.createEl('label', { cls: 'todo-step-add' });
    const stepAddIcon = stepComposer.createSpan({ cls: 'todo-step-add-icon' });
    setIcon(stepAddIcon, 'plus');
    const stepInput = stepComposer.createEl('input', { cls: 'todo-step-add-input' });
    stepInput.setAttr('type', 'text');
    stepInput.setAttr('placeholder', t('taskDetail.addStepPlaceholder'));
    stepInput.setAttr('maxlength', '255');
    stepInput.setAttr('aria-label', t('taskDetail.addStepPlaceholder'));

    const addStep = () => {
        const name = stepInput.value.trim();
        if (!name) {
            stepInput.focus();
            return;
        }
        const tempId = `local-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let createdItem: ChecklistItem | null = null;
        runChecklistMutation(
            tempId,
            async () => {
                createdItem = await api.createChecklistItem(list.id, task.id, name);
            },
            () => {
                task.checklistItems = [...(task.checklistItems || []), { id: tempId, displayName: name, isChecked: false }];
            },
            () => {
                task.checklistItems = (task.checklistItems || []).filter((item) => item.id !== tempId);
            },
            t('taskDetail.addStepFailed'),
            () => {
                if (createdItem) {
                    task.checklistItems = (task.checklistItems || []).map((item) =>
                        item.id === tempId ? createdItem as ChecklistItem : item);
                }
            },
        );
        refocusStepInput();
    };

    stepInput.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            addStep();
        }
    });

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
        const chipDate = new Date();
        chipDate.setDate(chipDate.getDate() + chip.days);
        const chipKey = toLocalDateKey(chipDate);
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
                () => api.updateTaskDueDate(list.id, task.id, chipKey),
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
