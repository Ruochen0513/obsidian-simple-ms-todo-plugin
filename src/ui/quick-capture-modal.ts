import { App, Modal, Notice } from 'obsidian';
import type MsTodoPlugin from '../main';
import { MsTodoApi, TodoList, TodoTask } from '../api/ms-todo-api';
import { formatShortDate } from '../utils/task-dates';
import { t } from '../i18n';
import { attachDatePicker } from './date-picker';

export class QuickCaptureModal extends Modal {
    private plugin: MsTodoPlugin;
    private api: MsTodoApi;
    private lists: TodoList[];
    private preferredListId?: string;

    private titleInput!: HTMLInputElement;
    private listSelect!: HTMLSelectElement;
    private dueDateInput!: HTMLInputElement;
    private confirmButton!: HTMLButtonElement;
    private submitting = false;
    private disposeDatePicker?: () => void;

    constructor(app: App, plugin: MsTodoPlugin, api: MsTodoApi, lists: TodoList[], preferredListId?: string) {
        super(app);
        this.plugin = plugin;
        this.api = api;
        this.lists = lists;
        this.preferredListId = preferredListId;
    }

    onOpen() {
        this.titleEl.setText(t('modal.quickCaptureTitle'));
        this.contentEl.addClass('todo-quick-capture-modal');

        this.titleInput = this.contentEl.createEl('input', {
            cls: 'todo-create-list-input',
            attr: { type: 'text', placeholder: t('modal.quickCapturePlaceholder'), maxlength: '255' },
        });
        this.titleInput.setAttr('aria-label', t('modal.quickCapturePlaceholder'));
        this.titleInput.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                void this.submit();
            }
        });

        const row = this.contentEl.createDiv({ cls: 'todo-quick-capture-row' });

        const listField = row.createEl('label', { cls: 'todo-quick-capture-field' });
        listField.createSpan({ cls: 'todo-quick-capture-label', text: t('modal.quickCaptureTargetList') });
        this.listSelect = listField.createEl('select', { cls: 'dropdown todo-quick-capture-select' });
        this.listSelect.setAttr('aria-label', t('modal.quickCaptureTargetList'));
        this.lists.forEach((list) => {
            const option = this.listSelect.createEl('option');
            option.value = list.id;
            option.text = list.displayName;
        });
        if (this.preferredListId && this.lists.some((list) => list.id === this.preferredListId)) {
            this.listSelect.value = this.preferredListId;
        }

        const dateField = row.createEl('label', { cls: 'todo-quick-capture-field' });
        dateField.createSpan({ cls: 'todo-quick-capture-label', text: t('modal.quickCaptureDueDate') });
        this.dueDateInput = dateField.createEl('input', { type: 'date', cls: 'todo-quick-capture-date' });
        this.dueDateInput.setAttr('aria-label', t('modal.quickCaptureDueDate'));
        this.disposeDatePicker = attachDatePicker(this.app, this.plugin, this.dueDateInput, this.scope);
        this.contentEl.createDiv({ cls: 'todo-quick-capture-hint', text: t('modal.quickCaptureDateHint') });

        const actions = this.contentEl.createDiv({ cls: 'todo-delete-confirm-actions' });
        const cancel = actions.createEl('button', { text: t('common.cancel') });
        cancel.setAttr('type', 'button');
        cancel.onclick = () => this.close();

        this.confirmButton = actions.createEl('button', { text: t('common.add'), cls: 'mod-cta' });
        this.confirmButton.setAttr('type', 'button');
        this.confirmButton.onclick = () => { void this.submit(); };

        window.setTimeout(() => this.titleInput.focus(), 0);
    }

    onClose() {
        this.disposeDatePicker?.();
        this.disposeDatePicker = undefined;
    }

    private async submit() {
        if (this.submitting) return;
        if (!this.api.isCurrentSession()) {
            this.close();
            return;
        }
        const title = this.titleInput.value.trim();
        if (!title) {
            this.titleInput.focus();
            return;
        }
        const list = this.lists.find((item) => item.id === this.listSelect.value);
        if (!list) return;

        this.submitting = true;
        this.confirmButton.disabled = true;
        this.confirmButton.setText(t('modal.quickCaptureAdding'));

        let task: TodoTask | null = null;
        const dueDate = this.dueDateInput.value;
        try {
            task = await this.api.createTask(list.id, title);
            if (dueDate) {
                task = await this.api.updateTaskDueDate(list.id, task.id, dueDate);
            }

            this.plugin.getTodoView()?.handleExternalTaskCreated(task, list);
            new Notice(t(dueDate ? 'notices.taskAddedWithDate' : 'notices.taskAddedTo', { listName: list.displayName, date: formatShortDate(dueDate) }));
            this.close();
        } catch (error) {
            if (!this.api.isCurrentSession()) {
                this.close();
                return;
            }
            if (task) {
                this.plugin.getTodoView()?.handleExternalTaskCreated(task, list);
                new Notice(t('notices.taskCreatedDateFailed', { listName: list.displayName }));
                console.error(error);
                this.close();
                return;
            }
            this.submitting = false;
            this.confirmButton.disabled = false;
            this.confirmButton.setText(t('common.add'));
            new Notice(t('notices.addTaskFailed'));
            console.error(error);
        }
    }
}
