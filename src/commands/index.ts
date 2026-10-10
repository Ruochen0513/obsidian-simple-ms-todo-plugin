import { Notice } from 'obsidian';
import type MsTodoPlugin from '../main';
import { MsTodoApi, type TodoList } from '../api/ms-todo-api';
import { QuickCaptureModal } from '../ui/quick-capture-modal';
import { t } from '../i18n';

export function registerCommands(plugin: MsTodoPlugin) {
    const ids = ['open-view', 'quick-capture', 'sync-to-markdown'] as const;
    ids.forEach((id) => plugin.removeCommand(id));

    plugin.addCommand({
        id: 'open-view',
        name: t('commands.openView'),
        callback: () => { void plugin.activateView(); },
    });

    plugin.addCommand({
        id: 'quick-capture',
        name: t('commands.quickCapture'),
        callback: () => { void openQuickCapture(plugin); },
    });

    plugin.addCommand({
        id: 'sync-to-markdown',
        name: t('commands.syncToMarkdown'),
        callback: () => syncTasksToMarkdown(plugin),
    });
}

export async function openQuickCapture(plugin: MsTodoPlugin) {
    if (!plugin.session.signedIn) {
        new Notice(t('notices.signInRequiredForQuickCapture'));
        return;
    }

    const api = new MsTodoApi(plugin);
    let lists: TodoList[] = [];
    const view = plugin.getTodoView();
    if (view && view.currentLists.length > 0) {
        lists = view.currentLists;
    } else {
        try {
            lists = await api.getTaskLists();
        } catch (error) {
            new Notice(t('notices.loadListsFailed'));
            console.error(error);
            return;
        }
    }

    const defaultList = lists.find((list) => list.wellknownListName === 'defaultList') || lists[0];
    if (!api.isCurrentSession()) return;
    const currentList = view ? view.getSelectedList(view.currentLists) : null;
    const preferredListId = currentList?.id || defaultList?.id;
    new QuickCaptureModal(plugin.app, plugin, api, lists, preferredListId).open();
}

export async function syncTasksToMarkdown(plugin: MsTodoPlugin, options: { silent?: boolean } = {}) {
    if (!plugin.session.signedIn) {
        new Notice(t('notices.signInRequired'));
        return;
    }

    if (!plugin.settings.markdownSyncEnabled) {
        if (!options.silent) {
            new Notice(t('notices.markdownSyncDisabled'));
        }
        return;
    }

    try {
        const api = new MsTodoApi(plugin);
        const result = await api.syncAllTasksToMarkdown();
        if (!options.silent) {
            new Notice(t('notices.syncCompleted', { listCount: result.listCount, taskCount: result.taskCount, path: result.path }));
        }
    } catch (error) {
        console.error(error);
        if (!options.silent) {
            new Notice(t('notices.syncFailed'));
        }
    }
}
