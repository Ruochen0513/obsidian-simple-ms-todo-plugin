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
