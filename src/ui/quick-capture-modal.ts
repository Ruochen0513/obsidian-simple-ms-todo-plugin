import { App, Modal, Notice } from 'obsidian';
import type MsTodoPlugin from '../main';
import { MsTodoApi, TodoList, TodoTask } from '../api/ms-todo-api';
import { toLocalDateKey } from './todo-view';
import { t } from '../i18n';

export class QuickCaptureModal extends Modal {
    private plugin: MsTodoPlugin;
    private api: MsTodoApi;
    private lists: TodoList[];
    private preferredListId?: string;

    private titleInput!: HTMLInputElement;
    private listSelect!: HTMLSelectElement;
    private todayToggle!: HTMLInputElement;
    private confirmButton!: HTMLButtonElement;
    private submitting = false;

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
        this.titleInput.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.submit();
            }
        });

        const row = this.contentEl.createDiv({ cls: 'todo-quick-capture-row' });

        const listField = row.createDiv({ cls: 'todo-quick-capture-field' });
        listField.createDiv({ cls: 'todo-quick-capture-label', text: t('modal.quickCaptureTargetList') });
        this.listSelect = listField.createEl('select', { cls: 'dropdown todo-quick-capture-select' });
        this.lists.forEach((list) => {
            const option = this.listSelect.createEl('option');
            option.value = list.id;
            option.text = list.displayName;
        });
        if (this.preferredListId && this.lists.some((list) => list.id === this.preferredListId)) {
            this.listSelect.value = this.preferredListId;
        }

        const todayField = row.createDiv({ cls: 'todo-quick-capture-field' });
        const todayLabel = todayField.createEl('label', { cls: 'todo-quick-capture-today' });
        this.todayToggle = todayLabel.createEl('input', { type: 'checkbox' });
        todayLabel.createSpan({ text: t('modal.quickCaptureDueToday') });

        const actions = this.contentEl.createDiv({ cls: 'todo-delete-confirm-actions' });
        const cancel = actions.createEl('button', { text: t('common.cancel') });
        cancel.setAttr('type', 'button');
        cancel.onclick = () => this.close();

        this.confirmButton = actions.createEl('button', { text: t('common.add'), cls: 'mod-cta' });
        this.confirmButton.setAttr('type', 'button');
        this.confirmButton.onclick = () => { void this.submit(); };

        window.setTimeout(() => this.titleInput.focus(), 0);
    }

    private async submit() {
        if (this.submitting) return;
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

        try {
            let task: TodoTask = await this.api.createTask(list.id, title);
            const dueToday = this.todayToggle.checked;
            if (dueToday) {
                task = await this.api.updateTaskDueDate(list.id, task.id, toLocalDateKey(new Date()));
            }

            this.plugin.getTodoView()?.handleExternalTaskCreated(task, list, dueToday);
            new Notice(t('notices.taskAddedTo', { listName: list.displayName }) + (dueToday ? t('notices.taskAddedDueTodaySuffix') : ''));
            this.close();
        } catch (error) {
            this.submitting = false;
            this.confirmButton.disabled = false;
            this.confirmButton.setText(t('common.add'));
            new Notice(t('notices.addTaskFailed'));
            console.error(error);
        }
    }
}
