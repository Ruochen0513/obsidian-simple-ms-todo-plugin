import { App, Modal } from 'obsidian';
import { t } from '../i18n';

interface DeleteConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
}

export class DeleteConfirmModal extends Modal {
    private options: DeleteConfirmOptions;
    private resolve: (confirmed: boolean) => void;
    private settled = false;

    constructor(app: App, options: DeleteConfirmOptions, resolve: (confirmed: boolean) => void) {
        super(app);
        this.options = options;
        this.resolve = resolve;
    }

    onOpen() {
        this.titleEl.setText(this.options.title);
        this.contentEl.addClass('todo-delete-confirm-modal');

        this.contentEl.createEl('p', { text: this.options.message });

        const actions = this.contentEl.createDiv({ cls: 'todo-delete-confirm-actions' });
        const cancel = actions.createEl('button', { text: t('common.cancel') });
        cancel.setAttr('type', 'button');
        cancel.onclick = () => this.finish(false);

        const confirm = actions.createEl('button', {
            text: this.options.confirmText ?? t('common.delete'),
            cls: 'mod-warning todo-delete-confirm-button',
        });
        confirm.setAttr('type', 'button');
        confirm.onclick = () => this.finish(true);
    }

    onClose() {
        this.contentEl.empty();
        if (!this.settled) {
            this.settled = true;
            this.resolve(false);
        }
    }

    private finish(confirmed: boolean) {
        if (this.settled) return;
        this.settled = true;
        this.resolve(confirmed);
        this.close();
    }
}

export class CreateListModal extends Modal {
    private resolve: (name: string | null) => void;
    private settled = false;
    private input!: HTMLInputElement;

    constructor(app: App, resolve: (name: string | null) => void) {
        super(app);
        this.resolve = resolve;
    }

    onOpen() {
        this.titleEl.setText(t('sidebar.newList'));
        this.contentEl.addClass('todo-create-list-modal');

        this.input = this.contentEl.createEl('input', {
            cls: 'todo-create-list-input',
            attr: { type: 'text', placeholder: t('modal.createListPlaceholder'), maxlength: '64' },
        });
        this.input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.submit();
            }
        });
        window.setTimeout(() => this.input.focus(), 0);

        const actions = this.contentEl.createDiv({ cls: 'todo-delete-confirm-actions' });
        const cancel = actions.createEl('button', { text: t('common.cancel') });
        cancel.setAttr('type', 'button');
        cancel.onclick = () => this.finish(null);

        const confirm = actions.createEl('button', { text: t('common.create'), cls: 'mod-cta' });
        confirm.setAttr('type', 'button');
        confirm.onclick = () => this.submit();
    }

    onClose() {
        this.contentEl.empty();
        if (!this.settled) {
            this.settled = true;
            this.resolve(null);
        }
    }

    private submit() {
        const name = this.input.value.trim();
        if (!name) {
            this.input.focus();
            return;
        }
        this.finish(name);
    }

    private finish(name: string | null) {
        if (this.settled) return;
        this.settled = true;
        this.resolve(name);
        this.close();
    }
}
