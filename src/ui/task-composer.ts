import { Notice, setIcon, type App } from 'obsidian';
import type { MsTodoApi } from '../api/ms-todo-api';
import type { TodoView } from './todo-view';
import { t } from '../i18n';

export function renderTaskComposer(view: TodoView, api: MsTodoApi, parent: HTMLElement) {
    const draft = view.taskComposerDraft;
    const row = parent.createDiv({ cls: 'todo-capture-entry' });
    const add = row.createEl('button', { cls: 'todo-capture-submit', attr: { type: 'button', 'aria-label': t('sidebar.addTask') } });
    setIcon(add, 'plus');
    const input = row.createEl('input', { cls: 'todo-capture-input', attr: {
        type: 'text', maxlength: '255', 'aria-label': t('sidebar.addTask'), enterkeyhint: 'done',
    } });
    const targetList = () => view.getSelectedList(view.currentLists)
        || view.currentLists.find(list => list.wellknownListName === 'defaultList') || view.currentLists[0];
    // Obsidian's assigned shortcut formatter is not exposed in its public types.
    const hotkeyManager = (view.app as App & {
        hotkeyManager?: { printHotkeyForCommand?: (id: string) => string };
    }).hotkeyManager;
    const update = () => {
        const list = targetList();
        if (input.value !== draft.value) input.value = draft.value;
        input.readOnly = draft.submitting;
        input.disabled = !list;
        input.setAttr('title', t('sidebar.addTaskHint', { listName: list?.displayName || t('common.tasks') }));
        row.setAttr('aria-busy', String(draft.submitting));
        add.disabled = draft.submitting || !list;
        add.setAttr('aria-label', t(draft.submitting ? 'modal.quickCaptureAdding' : 'sidebar.addTask'));
        const hotkey = hotkeyManager?.printHotkeyForCommand?.(`${view.plugin.manifest.id}:quick-capture`) || '';
        input.setAttr('placeholder', hotkey
            ? t('sidebar.quickInputShortcut', { hotkey: hotkey.replace(/\s*\+\s*/g, '+') }) : t('sidebar.quickInput'));
    };
    view.updateTaskComposer = update;
    update();

    const submit = async () => {
        const title = draft.value.trim();
        const list = targetList();
        if (draft.submitting || !title || !list || !api.isCurrentSession()) return;
        draft.submitting = true;
        update();
        try {
            const task = await api.createTask(list.id, title);
            if (!api.isCurrentSession()) return;
            draft.value = '';
            view.plugin.getTodoView()?.handleExternalTaskCreated(task, list);
            new Notice(t('notices.taskAddedTo', { listName: list.displayName }));
        } catch (error) {
            if (!api.isCurrentSession()) return;
            new Notice(t('notices.addTaskFailed'));
            console.error(error);
        } finally {
            draft.submitting = false;
            if (api.isCurrentSession()) view.updateTaskComposer?.();
        }
    };
    input.oninput = () => { draft.value = input.value; update(); };
    input.onkeydown = event => {
        if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        void submit();
    };
    input.onfocus = row.onmouseenter = update;
    row.onclick = event => {
        if (event.target === row) input.focus();
    };
    add.onclick = () => { input.focus(); void submit(); };
}
