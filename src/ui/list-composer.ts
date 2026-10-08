import { setIcon } from 'obsidian';
import type { MsTodoApi, TodoList } from '../api/ms-todo-api';
import type { TodoView } from './todo-view';
import { t } from '../i18n';

export function renderListComposer(
    view: TodoView, api: MsTodoApi, parent: HTMLElement,
    onCreated: (list: TodoList) => void,
) {
    const host = parent.createDiv({ cls: 'todo-list-create' });
    const trigger = host.createEl('button', { cls: 'todo-list-menu-item todo-list-menu-create', attr: { type: 'button' } });
    setIcon(trigger.createSpan({ cls: 'todo-list-menu-item-icon' }), 'plus');
    trigger.createSpan({ cls: 'todo-list-menu-item-label', text: t('sidebar.newList') });
    const row = host.createDiv({ cls: 'todo-list-create-row' });
    row.hidden = true;
    const add = row.createEl('button', { cls: 'todo-icon-button', attr: { type: 'button', 'aria-label': t('common.create') } });
    setIcon(add, 'plus');
    const input = row.createEl('input', { cls: 'todo-list-create-input', attr: {
        type: 'text', maxlength: '64', placeholder: t('modal.createListPlaceholder'), 'aria-label': t('sidebar.listName'), enterkeyhint: 'done',
    } });
    const cancel = row.createEl('button', { cls: 'todo-icon-button', attr: { type: 'button', 'aria-label': t('common.cancel') } });
    setIcon(cancel, 'x');
    let submitting = false;
    const reset = () => {
        input.value = '';
        row.hidden = true;
        trigger.hidden = false;
        trigger.focus();
    };
    trigger.onclick = () => {
        trigger.hidden = true;
        row.hidden = false;
        input.focus();
    };
    cancel.onclick = reset;
    const submit = async () => {
        const name = input.value.trim();
        if (submitting || !name || name.length > 64 || !api.isCurrentSession()) return;
        submitting = true;
        input.readOnly = true;
        add.disabled = cancel.disabled = true;
        row.setAttr('aria-busy', 'true');
        const list = await view.createList(api, name);
        submitting = false;
        input.readOnly = false;
        add.disabled = cancel.disabled = false;
        row.setAttr('aria-busy', 'false');
        if (!list || !api.isCurrentSession() || !host.isConnected) return;
        const restoreFocus = input.ownerDocument.activeElement === input;
        input.value = '';
        row.hidden = true;
        trigger.hidden = false;
        onCreated(list);
        if (restoreFocus) {
            trigger.focus();
            trigger.scrollIntoView({ block: 'nearest' });
        }
    };
    add.onclick = () => { input.focus(); void submit(); };
    input.onkeydown = event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
        } else if (event.key === 'Escape' && !submitting) {
            event.preventDefault();
            event.stopPropagation();
            reset();
        }
    };
}
