import { Component, setIcon, Notice } from 'obsidian';
import type { TodoView } from './todo-view';
import type { MsTodoApi, TodoList, TodoTask, ChecklistItem } from '../api/ms-todo-api';
import { t } from '../i18n';
import { applyChecklistOrder, checklistOrderKey } from '../utils/checklist-order';
import { attachStepEditor } from './step-editor';
import { attachStepReorder } from './step-reorder';

export function renderTaskSteps(view: TodoView, api: MsTodoApi, detail: HTMLElement, listArea: HTMLElement, list: TodoList, task: TodoTask) {
    const owner = view.addChild(new Component());
    view.disposeDetailSteps = () => view.removeChild(owner);
    applyChecklistOrder(task, list.id, view.plugin.checklistOrders);
    const stepsCard = detail.createDiv({ cls: 'todo-detail-card' });
    const stepsLabel = stepsCard.createDiv({ cls: 'todo-detail-card-label' });
    const stepsLabelIcon = stepsLabel.createSpan();
    setIcon(stepsLabelIcon, 'list-checks');
    stepsLabel.createSpan({ text: t('taskDetail.stepsLabel') });
    const checklistItems = task.checklistItems || [];
    const orderKey = checklistOrderKey(list.id, task.id);
    const stepList = stepsCard.createDiv({ cls: 'todo-step-list' });
    const orderStatus = stepsCard.createDiv({ cls: 'todo-step-order-status', attr: { 'aria-live': 'polite' } });
    const orderDisabled = () => !api.isCurrentSession() || view.pendingChecklistOrderTaskIds.has(orderKey)
        || [...view.pendingChecklistItemIds].some(key => key.startsWith(`${task.id}:`));
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
        const stepRow = stepList.createDiv({ cls: 'todo-step-row' });
        stepRow.setAttr('data-step-id', step.id);
        const dragHandle = stepRow.createEl('button', { cls: 'todo-step-drag', attr: { type: 'button' } });
        dragHandle.setAttr('aria-label', t('taskDetail.moveStepAria', { stepName: step.displayName }));
        dragHandle.setAttr('title', t('taskDetail.moveStepHint'));
        setIcon(dragHandle, 'grip-vertical');
        const checked = stepRow.createEl('input', { type: 'checkbox', cls: 'todo-step-checkbox' });
        checked.checked = step.isChecked;
        checked.disabled = pending;
        checked.setAttr('aria-label', step.isChecked ? t('taskDetail.reopenStepAria', { stepName: step.displayName }) : t('taskDetail.completeStepAria', { stepName: step.displayName }));
        const stepLabel = stepRow.createDiv({ cls: 'todo-step-label' });
        if (step.isChecked) stepLabel.addClass('is-checked');
        const draftKey = JSON.stringify([list.id, task.id, step.id]);
        attachStepEditor(view.app, owner, stepLabel, step.displayName, view.stepDrafts, draftKey,
            () => !api.isCurrentSession() || view.pendingChecklistItemIds.has(`${task.id}:${step.id}`),
            (name, restoreFocus) => {
                runChecklistMutation(step.id,
                    () => api.updateChecklistItem(list.id, task.id, step.id, { displayName: name }),
                    () => {
                        task.checklistItems = (task.checklistItems || []).map(item =>
                            item.id === step.id ? { ...item, displayName: name } : item);
                    },
                    () => {
                        task.checklistItems = (task.checklistItems || []).map(item =>
                            item.id === step.id ? { ...item, displayName: step.displayName } : item);
                        if (!view.stepDrafts.has(draftKey)) view.stepDrafts.set(draftKey, name);
                    }, t('taskDetail.updateStepFailed'));
                if (restoreFocus) {
                    const row = Array.from(detail.querySelectorAll<HTMLElement>('.todo-step-row'))
                        .find(item => item.getAttr('data-step-id') === step.id);
                    row?.querySelector<HTMLElement>('.todo-step-label')?.focus();
                }
            }, view.scope);
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

    let savedOrder = checklistItems.map(item => item.id);
    attachStepReorder(owner, stepList, orderDisabled, ids => {
        if (orderDisabled()) return;
        const previous = view.plugin.checklistOrders[orderKey];
        const previousIds = savedOrder;
        if (ids.every((id, index) => id === previousIds[index])) return;
        savedOrder = ids;
        view.pendingChecklistOrderTaskIds.add(orderKey);
        view.plugin.checklistOrders[orderKey] = ids;
        void (async () => {
            try {
                await view.plugin.saveSettings();
                if (!api.isCurrentSession()) return;
                orderStatus.setText(t('taskDetail.stepOrderSaved'));
            } catch (error) {
                if (!api.isCurrentSession()) return;
                if (previous) view.plugin.checklistOrders[orderKey] = previous;
                else delete view.plugin.checklistOrders[orderKey];
                savedOrder = previousIds;
                for (const current of [task, ...view.currentTasks, ...(view.taskCache.get(list.id)?.tasks || [])]) {
                    if (current.id === task.id) applyChecklistOrder(current, list.id, { [orderKey]: previousIds });
                }
                const rows = Array.from(stepList.querySelectorAll<HTMLElement>('.todo-step-row'));
                previousIds.forEach(id => {
                    const row = rows.find(item => item.getAttr('data-step-id') === id);
                    if (row) stepList.appendChild(row);
                });
                new Notice(t('taskDetail.moveStepFailed'));
                if (view.selectedTaskId === task.id && !stepList.isConnected) {
                    view.renderTaskList(api, list, listArea, detail);
                }
                console.error(error);
            } finally {
                view.pendingChecklistOrderTaskIds.delete(orderKey);
            }
        })();
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

    owner.registerDomEvent(stepInput, 'keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            addStep();
        }
    });

}
