import { Component, ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import type MsTodoPlugin from '../main';
import { MsTodoApi, TodoList, TodoTask } from '../api/ms-todo-api';
import { syncTasksToMarkdown } from '../commands';
import { t } from '../i18n';
import { taskBodyText } from '../utils/task-body';
import { buildTaskMeta, toLocalDateKey, isTaskOverdue, formatShortDate } from '../utils/task-dates';
import { getPlannedDate, isPlannedTask, groupPlannedTasks } from '../utils/planned-tasks';
import type { TaskCacheEntry, TaskCacheSnapshot } from '../sync/task-cache';
import { DeleteConfirmModal } from './task-modals';
import { renderTaskDetail } from './task-detail';
import { renderTaskComposer } from './task-composer';
import { renderListComposer } from './list-composer';
import { checklistOrderKey } from '../utils/checklist-order';

export const VIEW_TYPE_TODO = 'ms-todo-view';
const PLANNED_VIEW_ID = '__planned__';
const COMPLETED_VIEW_ID = '__completed__';

function isSmartViewId(id: string | null): boolean {
    return id === PLANNED_VIEW_ID || id === COMPLETED_VIEW_ID;
}

const TASK_CACHE_TTL_MS = 30_000;

export class TodoView extends ItemView {
    plugin: MsTodoPlugin;
    selectedListId: string | null = PLANNED_VIEW_ID;
    selectedTaskId: string | null = null;
    showEarlier = false;
    currentTasks: TodoTask[] = [];
    currentLists: TodoList[] = [];
    viewTransitionToken = 0;
    taskListByTaskId = new Map<string, TodoList>();
    taskCache = new Map<string, TaskCacheEntry>();
    pendingTaskIds = new Set<string>();
    private deletedTaskIds = new Set<string>();
    pendingChecklistItemIds = new Set<string>();
    recentlyMutatedTaskIds = new Set<string>();
    mainListArea: HTMLElement | null = null;
    mainDetail: HTMLElement | null = null;
    currentRenderList: TodoList | null = null;
    cachePersistTimer: number | null = null;
    searchQuery = '';
    searchInputEl: HTMLInputElement | null = null;
    searchHostEl: HTMLElement | null = null;
    searchToggleFn: (() => void) | null = null;
    private searchTimer: number | null = null;
    private noteDrafts = new Map<string, string>();
    stepDrafts = new Map<string, string>();
    stepScrollPositions = new Map<string, number>();
    pendingChecklistOrderTaskIds = new Set<string>();
    disposeDetailSteps?: () => void;
    disposeDetailDatePicker?: () => void;
    taskComposerDraft = { value: '', submitting: false };
    updateTaskComposer?: () => void;
    private cacheSession: number;
    private listMutationVersion = 0;
    private shellEvents?: Component;

    constructor(leaf: WorkspaceLeaf, plugin: MsTodoPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.selectedListId = plugin.settings.defaultViewId;
        this.cacheSession = plugin.session.version;
    }

    getViewType() { return VIEW_TYPE_TODO; }
    getDisplayText() { return 'Microsoft To Do'; }
    getIcon() { return 'check-square'; }

    async onOpen() {
        await this.render();
    }

    async onClose() {
        this.updateTaskComposer = undefined;
        this.clearShellEvents();
        this.clearDetailControls();
        this.clearSearchState();
        this.flushTaskCachePersist();
    }

    async render() {
        this.updateTaskComposer = undefined;
        this.clearShellEvents();
        this.clearDetailControls();
        const accountChanged = this.cacheSession !== this.plugin.session.version;
        this.cacheSession = this.plugin.session.version;
        this.clearSearchState();
        const token = this.viewTransitionToken;
        this.searchInputEl = null;
        this.searchHostEl = null;
        this.searchToggleFn = null;
        const container = this.contentEl;
        container.empty();
        container.addClass('ms-todo-container');

        if (!this.plugin.session.signedIn || accountChanged) {
            this.taskComposerDraft = { value: '', submitting: false };
            if (this.cachePersistTimer !== null) window.clearTimeout(this.cachePersistTimer);
            this.cachePersistTimer = null;
            this.taskCache.clear();
            this.noteDrafts.clear();
            this.stepDrafts.clear();
            this.stepScrollPositions.clear();
            this.pendingChecklistOrderTaskIds.clear();
            this.pendingTaskIds.clear();
            this.deletedTaskIds.clear();
            this.pendingChecklistItemIds.clear();
            this.recentlyMutatedTaskIds.clear();
            this.selectedListId = this.plugin.settings.defaultViewId;
            this.selectedTaskId = null;
            this.showEarlier = false;
            this.currentLists = [];
            this.currentTasks = [];
            this.taskListByTaskId.clear();
            this.mainListArea = null;
            this.mainDetail = null;
            this.currentRenderList = null;
            if (!this.plugin.session.signedIn) {
                this.renderSignedOut(container);
                return;
            }
        }

        const snapshot = this.plugin.taskCacheSnapshot;
        if (snapshot && snapshot.lists.length > 0 && this.restoreTaskCache(snapshot)) {
            this.currentLists = snapshot.lists;
            this.normalizeSelectedView(this.currentLists);
            const api = new MsTodoApi(this.plugin);
            await this.renderShell(api, container, this.currentLists);
            void this.refreshListsInBackground(api);
            return;
        }

        const loading = container.createDiv({ cls: 'todo-loading' });
        loading.createDiv({ cls: 'todo-loading-spinner' });
        loading.createSpan({ text: t('notices.loadingMsTodo') });

        try {
            const api = new MsTodoApi(this.plugin);
            const lists = await api.getTaskLists();
            if (token !== this.viewTransitionToken || !api.isCurrentSession()) return;

            if (!lists || lists.length === 0) {
                loading.remove();
                this.renderEmptyLists(container, api);
                return;
            }

            loading.remove();
            this.currentLists = lists;
            this.scheduleCachePersist();
            this.normalizeSelectedView(lists);
            await this.renderShell(api, container, lists);
        } catch (error) {
            if (token !== this.viewTransitionToken) return;
            loading.empty();
            loading.addClass('todo-error');
            loading.createSpan({ text: t('notices.loadFailed') });
            container.createEl('div', { text: String(error), cls: 'todo-error-detail' });
            console.error(error);
        }
    }

    renderSignedOut(container: HTMLElement) {
        const hero = container.createDiv({ cls: 'todo-signed-out' });
        const icon = hero.createDiv({ cls: 'todo-signed-out-icon' });
        setIcon(icon, 'check-check');
        hero.createEl('h3', { text: 'Microsoft To Do' });
        hero.createEl('p', { text: t('signedOut.subtitle') });
        const loginBtn = hero.createEl('button', { text: t('signedOut.signInButton'), cls: 'todo-primary-button' });
        loginBtn.onclick = () => this.plugin.login();
    }

    renderEmptyLists(container: HTMLElement, api: MsTodoApi) {
        const hero = container.createDiv({ cls: 'todo-signed-out' });
        const icon = hero.createDiv({ cls: 'todo-signed-out-icon' });
        setIcon(icon, 'list-plus');
        const heading = hero.createEl('h3', { text: t('empty.noListsTitle') });
        const subtitle = hero.createEl('p', { text: t('empty.noListsSubtitle') });
        const lists = hero.createDiv();
        const openList = (list: TodoList) => {
            this.selectedListId = list.id;
            void this.render();
        };
        renderListComposer(this, api, hero, list => {
            heading.setText(t('sidebar.lists'));
            subtitle.remove();
            const item = lists.createEl('button', { cls: 'todo-list-menu-item', attr: { type: 'button', 'data-list-id': list.id } });
            setIcon(item.createSpan({ cls: 'todo-list-menu-item-icon' }), 'list');
            item.createSpan({ cls: 'todo-list-menu-item-label', text: list.displayName });
            item.onclick = () => openList(list);
        });
    }

    normalizeSelectedView(lists: TodoList[]) {
        if (isSmartViewId(this.selectedListId)) return;
        if (this.selectedListId && lists.some((list) => list.id === this.selectedListId)) return;
        this.selectedListId = PLANNED_VIEW_ID;
    }

    getSelectedList(lists: TodoList[]): TodoList | null {
        if (!this.selectedListId || isSmartViewId(this.selectedListId)) return null;
        return lists.find((list) => list.id === this.selectedListId) || null;
    }

    async renderShell(api: MsTodoApi, container: HTMLElement, lists: TodoList[]) {
        const app = container.createDiv({ cls: 'todo-app-shell' });

        const header = app.createDiv({ cls: 'todo-header' });
        const brand = header.createDiv({ cls: 'todo-brand' });
        brand.createSpan({ text: 'Microsoft To Do', cls: 'todo-brand-text' });

        const selectedList = this.getSelectedList(lists);
        const actions = header.createDiv({ cls: 'todo-header-actions' });
        this.createIconButton(actions, 'rotate-cw', t('common.refresh'), () => { void this.render(); });
        this.createIconButton(actions, 'search', t('sidebar.searchTasks'), () => { this.searchToggleFn?.(); });
        this.createIconButton(actions, 'more-vertical', t('common.more'), (event) => {
            this.showMoreMenu(event, api, this.getSelectedList(this.currentLists));
        });

        const selectorHost = app.createDiv({ cls: 'todo-view-selector-host' });
        const main = app.createDiv({ cls: 'todo-main-panel' });
        this.renderViewSelector(api, selectorHost, lists, main);
        this.renderSearchBar(api, selectorHost, main, lists);
        this.renderTaskSkeleton(main);

        renderTaskComposer(this, api, app);

        if (this.selectedListId === COMPLETED_VIEW_ID) {
            await this.loadCompletedView(api, main, lists);
        } else if (this.selectedListId === PLANNED_VIEW_ID) {
            await this.loadPlannedView(api, main, lists);
        } else if (selectedList) {
            await this.loadTaskList(api, main, selectedList);
        }
    }

    renderViewSelector(
        api: MsTodoApi,
        parent: HTMLElement,
        lists: TodoList[],
        main: HTMLElement,
    ) {
        const owner = this.shellEvents ??= this.addChild(new Component());
        const wrapper = parent.createDiv({ cls: 'todo-view-selector-wrap' });
        const selector = wrapper.createEl('button', { cls: 'todo-view-selector' });
        selector.setAttr('type', 'button');
        selector.setAttr('aria-expanded', 'false');

        const selectorIcon = selector.createSpan({ cls: 'todo-view-selector-icon' });
        const label = selector.createSpan({ cls: 'todo-view-selector-label' });
        const chevron = selector.createSpan({ cls: 'todo-view-selector-chevron' });
        setIcon(chevron, 'chevron-down');

        const updateSelector = () => {
            this.updateTaskComposer?.();
            selectorIcon.empty();
            if (isSmartViewId(this.selectedListId)) {
                const completed = this.selectedListId === COMPLETED_VIEW_ID;
                const name = completed ? t('smartView.completed') : t('smartView.planned');
                setIcon(selectorIcon, completed ? 'check-check' : 'calendar-days');
                label.setText(name);
                selector.setAttr('aria-label', t('sidebar.currentViewAria', { viewName: name }));
                return;
            }

            const list = this.getSelectedList(this.currentLists);
            setIcon(selectorIcon, 'list');
            label.setText(list?.displayName || t('common.tasks'));
            selector.setAttr('aria-label', t('sidebar.currentListAria', { listName: list?.displayName || t('common.tasks') }));
        };

        updateSelector();

        const panel = wrapper.createDiv({ cls: 'todo-list-menu' });
        panel.setAttr('role', 'region');
        panel.setAttr('aria-label', t('sidebar.switchViewAria'));
        const itemsHost = panel.createDiv();

        const closeMenu = () => {
            wrapper.removeClass('is-open');
            selector.setAttr('aria-expanded', 'false');
        };

        const switchToSmartView = (viewId: string) => {
            closeMenu();
            if (this.selectedListId === viewId) return;
            this.clearSearchState();
            this.selectedListId = viewId;
            this.selectedTaskId = null;
            this.showEarlier = false;
            updateSelector();
            renderMenuItems();
            const loader = viewId === COMPLETED_VIEW_ID
                ? (token: number) => this.loadCompletedView(api, main, this.currentLists, token)
                : (token: number) => this.loadPlannedView(api, main, this.currentLists, token);
            void this.transitionToView(api, main, loader);
        };

        const switchToList = (list: TodoList) => {
            closeMenu();
            if (list.id === this.selectedListId) return;
            this.clearSearchState();
            this.selectedListId = list.id;
            this.selectedTaskId = null;
            this.showEarlier = false;
            updateSelector();
            renderMenuItems();
            void this.transitionToView(api, main, (token) => this.loadTaskList(api, main, list, token));
        };

        const renderMenuItems = () => {
            itemsHost.empty();

            const addViewItem = (id: string, name: string, glyph: string) => {
                const item = itemsHost.createEl('button', { cls: 'todo-list-menu-item todo-smart-view-item' });
                item.setAttr('type', 'button');
                item.setAttr('data-view-id', id);
                if (this.selectedListId === id) item.addClass('is-active');
                const icon = item.createSpan({ cls: 'todo-list-menu-item-icon' });
                setIcon(icon, this.selectedListId === id ? 'check' : glyph);
                item.createSpan({ text: name, cls: 'todo-list-menu-item-label' });
                item.onclick = () => switchToSmartView(id);
            };
            addViewItem(PLANNED_VIEW_ID, t('smartView.planned'), 'calendar-days');

            itemsHost.createDiv({ cls: 'todo-list-menu-separator' });
            itemsHost.createDiv({ text: t('sidebar.lists'), cls: 'todo-list-menu-section-label' });

            this.currentLists.forEach((list) => {
                const item = itemsHost.createEl('button', { cls: 'todo-list-menu-item' });
                item.setAttr('type', 'button');
                item.setAttr('data-list-id', list.id);
                if (list.id === this.selectedListId) item.addClass('is-active');

                const icon = item.createSpan({ cls: 'todo-list-menu-item-icon' });
                setIcon(icon, list.id === this.selectedListId ? 'check' : 'list');
                item.createSpan({ text: list.displayName, cls: 'todo-list-menu-item-label' });
                item.onclick = () => switchToList(list);
            });
        };

        renderMenuItems();
        panel.createDiv({ cls: 'todo-list-menu-separator' });
        renderListComposer(this, api, panel, () => renderMenuItems());
        panel.createDiv({ cls: 'todo-list-menu-separator' });
        const completed = panel.createEl('button', { cls: 'todo-list-menu-item todo-smart-view-item todo-list-menu-secondary', attr: { type: 'button', 'data-view-id': COMPLETED_VIEW_ID } });
        const completedIcon = completed.createSpan({ cls: 'todo-list-menu-item-icon' });
        setIcon(completedIcon, 'check-check');
        completed.createSpan({ cls: 'todo-list-menu-item-label', text: t('smartView.completed') });
        completed.onclick = () => switchToSmartView(COMPLETED_VIEW_ID);

        selector.onclick = (event) => {
            event.stopPropagation();
            const nextOpen = !wrapper.hasClass('is-open');
            if (nextOpen) {
                renderMenuItems();
                completed.toggleClass('is-active', this.selectedListId === COMPLETED_VIEW_ID);
                setIcon(completedIcon, this.selectedListId === COMPLETED_VIEW_ID ? 'check' : 'check-check');
                const missing = this.currentLists.some((list) => !this.taskCache.has(list.id));
                if (missing) void this.warmAllListCaches(api, this.currentLists);
            }
            wrapper.toggleClass('is-open', nextOpen);
            selector.setAttr('aria-expanded', nextOpen ? 'true' : 'false');
        };

        panel.onclick = (event) => event.stopPropagation();

        const outsideClick = (event: MouseEvent) => {
            if (!wrapper.contains(event.target as Node)) closeMenu();
        };
        owner.registerDomEvent(document, 'click', outsideClick);
    }

    private clearShellEvents() {
        if (this.shellEvents) this.removeChild(this.shellEvents);
        this.shellEvents = undefined;
    }

    isSearchMode(): boolean {
        return this.searchQuery.trim().length > 0;
    }

    clearSearchState() {
        this.viewTransitionToken++;
        if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
        this.searchTimer = null;
        this.searchQuery = '';
        if (this.searchInputEl) this.searchInputEl.value = '';
    }

    renderSearchBar(api: MsTodoApi, host: HTMLElement, main: HTMLElement, lists: TodoList[]) {
        const owner = this.shellEvents ??= this.addChild(new Component());
        this.searchHostEl = host;
        const bar = host.createDiv({ cls: 'todo-search-bar' });
        const icon = bar.createSpan({ cls: 'todo-search-icon' });
        setIcon(icon, 'search');
        const input = bar.createEl('input', { cls: 'todo-search-input' });
        input.setAttr('type', 'text');
        input.setAttr('placeholder', t('search.placeholder'));
        input.setAttr('aria-label', t('search.ariaLabel'));
        this.searchInputEl = input;

        const clearBtn = bar.createEl('button', { cls: 'todo-search-clear' });
        clearBtn.setAttr('type', 'button');
        clearBtn.setAttr('aria-label', t('search.clearAria'));
        const clearIcon = clearBtn.createSpan();
        setIcon(clearIcon, 'x');

        const open = () => {
            host.addClass('is-searching');
            input.focus();
        };
        const close = () => {
            this.clearSearchState();
            clearBtn.removeClass('is-visible');
            host.removeClass('is-searching');
            input.blur();
            void this.restoreFromSearch(api, main, this.currentLists);
        };
        this.searchToggleFn = () => {
            if (host.hasClass('is-searching')) close();
            else open();
        };

        owner.registerDomEvent(document, 'click', (event: MouseEvent) => {
            if (host !== this.searchHostEl) return;
            if (!host.hasClass('is-searching')) return;
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (target.closest('.todo-search-bar, .todo-header, .todo-task-row, .todo-detail-panel, .todo-earlier-toggle')) return;
            close();
        });

        const applySearch = (value: string) => {
            this.viewTransitionToken++;
            if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
            this.searchTimer = window.setTimeout(() => {
                this.searchTimer = null;
                if (!api.isCurrentSession() || host !== this.searchHostEl) return;
                this.searchQuery = value;
                clearBtn.toggleClass('is-visible', value.length > 0);
                if (this.isSearchMode()) {
                    void this.runSearch(api, main, this.currentLists);
                } else {
                    void this.restoreFromSearch(api, main, this.currentLists);
                }
            }, 150);
        };

        input.addEventListener('input', () => applySearch(input.value));
        clearBtn.onclick = () => {
            input.value = '';
            applySearch('');
            input.focus();
        };
        input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        });
    }

    async runSearch(api: MsTodoApi, main: HTMLElement, lists: TodoList[]) {
        const token = ++this.viewTransitionToken;
        const query = this.searchQuery.trim().toLowerCase();
        try {
            await Promise.all(lists.map(list => this.ensureAllTasksLoaded(api, list.id)));
        } catch (error) {
            if (api.isCurrentSession() && token === this.viewTransitionToken) {
                new Notice(t('notices.loadViewFailed'));
                console.error(error);
            }
            return;
        }
        if (!api.isCurrentSession() || token !== this.viewTransitionToken || this.searchQuery.trim().toLowerCase() !== query) return;

        this.taskListByTaskId.clear();
        const results: TodoTask[] = [];
        lists.forEach((list) => {
            const entry = this.taskCache.get(list.id);
            if (!entry) return;
            entry.tasks.forEach((task) => {
                if (!task.title.toLowerCase().includes(query)) return;
                this.taskListByTaskId.set(task.id, list);
                results.push(task);
            });
        });

        results.sort((a, b) => {
            const aActive = a.status !== 'completed' ? 1 : 0;
            const bActive = b.status !== 'completed' ? 1 : 0;
            if (aActive !== bActive) return bActive - aActive;
            const aImportant = a.importance === 'high' ? 1 : 0;
            const bImportant = b.importance === 'high' ? 1 : 0;
            if (aImportant !== bImportant) return bImportant - aImportant;
            return (b.createdDateTime || '').localeCompare(a.createdDateTime || '');
        });

        this.currentTasks = results;
        main.removeClass('is-list-leaving', 'is-list-loading', 'is-list-entering');
        main.empty();
        const listArea = main.createDiv({ cls: 'todo-task-list-area' });
        const detail = main.createDiv({ cls: 'todo-detail-panel' });
        this.mainListArea = listArea;
        this.mainDetail = detail;
        this.currentRenderList = null;
        this.renderTaskList(api, null, listArea, detail);
    }

    async restoreFromSearch(api: MsTodoApi, main: HTMLElement, lists: TodoList[]) {
        const token = ++this.viewTransitionToken;
        main.removeClass('is-list-leaving', 'is-list-loading', 'is-list-entering');
        try {
            if (this.selectedListId === COMPLETED_VIEW_ID) {
                await this.loadCompletedView(api, main, lists, token);
            } else if (this.selectedListId === PLANNED_VIEW_ID) {
                await this.loadPlannedView(api, main, lists, token);
            } else {
                const list = this.getSelectedList(lists);
                if (list) await this.loadTaskList(api, main, list, token);
            }
        } catch (error) {
            if (api.isCurrentSession() && token === this.viewTransitionToken) {
                new Notice(t('notices.loadViewFailed'));
                console.error(error);
            }
        }
    }

    async transitionToView(api: MsTodoApi, main: HTMLElement, loader: (token: number) => Promise<void>) {
        const token = ++this.viewTransitionToken;

        main.addClass('is-list-leaving');
        await wait(110);
        if (token !== this.viewTransitionToken) return;

        this.renderTaskSkeleton(main);
        main.removeClass('is-list-leaving');
        main.addClass('is-list-loading');

        try {
            await loader(token);
            if (token !== this.viewTransitionToken) return;
            main.removeClass('is-list-loading');
            main.addClass('is-list-entering');
            window.setTimeout(() => {
                if (token === this.viewTransitionToken) main.removeClass('is-list-entering');
            }, 190);
        } catch (error) {
            if (token !== this.viewTransitionToken) return;
            main.removeClass('is-list-loading');
            main.empty();
            const state = main.createDiv({ cls: 'todo-inline-error' });
            state.createSpan({ text: t('notices.loadViewFailed') });
            console.error(error);
        }
    }

    renderTaskSkeleton(main: HTMLElement) {
        main.empty();
        const skeleton = main.createDiv({ cls: 'todo-list-skeleton', attr: { 'aria-label': t('sidebar.loadingListAria') } });

        for (let index = 0; index < 5; index++) {
            const row = skeleton.createDiv({ cls: 'todo-skeleton-row' });
            row.createSpan({ cls: 'todo-skeleton-check' });
            const content = row.createDiv({ cls: 'todo-skeleton-content' });
            content.createSpan({ cls: 'todo-skeleton-line todo-skeleton-title' });
            content.createSpan({ cls: 'todo-skeleton-line todo-skeleton-meta' });
        }
    }

    showMoreMenu(event: MouseEvent, api: MsTodoApi, selectedList: TodoList | null) {
        const menu = new Menu();

        if (this.plugin.settings.markdownSyncEnabled) {
            menu.addItem((item) => {
                item
                    .setTitle(t('sidebar.syncToNote'))
                    .setIcon('file-down')
                    .onClick(() => { void syncTasksToMarkdown(this.plugin); });
            });
        }

        if (selectedList && selectedList.wellknownListName !== 'defaultList') {
            menu.addItem((item) => {
                item
                    .setTitle(t('sidebar.deleteCurrentList'))
                    .setIcon('trash-2')
                    .onClick(() => { void this.deleteList(api, selectedList); });
            });
        }

        menu.addSeparator();
        menu.addItem((item) => {
            item
                .setTitle(t('common.signOut'))
                .setIcon('log-out')
                .onClick(async () => {
                    await this.plugin.clearData();
                });
        });

        const anchor = event.currentTarget as HTMLElement | null;
        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            menu.showAtPosition({ x: rect.right, y: rect.bottom }, event.view?.document ?? document);
        } else {
            menu.showAtMouseEvent(event);
        }
    }

    createIconButton(
        parent: HTMLElement,
        iconName: string,
        label: string,
        onClick: (event: MouseEvent) => void,
    ): HTMLButtonElement {
        const button = parent.createEl('button', { cls: 'todo-icon-button' });
        button.setAttr('type', 'button');
        button.setAttr('aria-label', label);
        setIcon(button, iconName);
        button.onclick = onClick;
        return button;
    }

    async createList(api: MsTodoApi, displayName: string): Promise<TodoList | null> {
        const name = displayName.trim();
        if (!name || name.length > 64 || !api.isCurrentSession()) return null;

        try {
            const list = await api.createTaskList(name);
            if (!api.isCurrentSession()) return null;
            this.listMutationVersion++;
            this.currentLists.push(list);
            this.setTaskCache(list.id, [], true);
            this.updateTaskComposer?.();
            new Notice(t('notices.listCreated'));
            return list;
        } catch (error) {
            if (!api.isCurrentSession()) return null;
            new Notice(t('notices.createListFailed'));
            console.error(error);
            return null;
        }
    }

    async deleteList(api: MsTodoApi, list: TodoList) {
        const confirmed = await new Promise<boolean>((resolve) => {
            new DeleteConfirmModal(this.app, {
                title: t('modal.deleteListTitle'),
                message: t('modal.deleteListMessage', { listName: list.displayName }),
            }, resolve).open();
        });
        if (!confirmed || !api.isCurrentSession()) return;

        try {
            await api.deleteTaskList(list.id);
            if (!api.isCurrentSession()) return;
            this.listMutationVersion++;
            this.currentLists = this.currentLists.filter(item => item.id !== list.id);
            this.taskCache.delete(list.id);
            this.scheduleCachePersist();
            this.flushTaskCachePersist();
            if (this.selectedListId === list.id) {
                this.selectedListId = PLANNED_VIEW_ID;
                this.selectedTaskId = null;
            }
            this.showEarlier = false;
            new Notice(t('notices.listDeleted'));
            await this.render();
        } catch (error) {
            if (!api.isCurrentSession()) return;
            new Notice(t('notices.deleteListFailed'));
            console.error(error);
        }
    }

    getTaskCache(listId: string): TaskCacheEntry | null {
        return this.taskCache.get(listId) || null;
    }

    setTaskCache(listId: string, tasks: TodoTask[], allLoaded: boolean) {
        const existing = this.taskCache.get(listId);
        this.taskCache.set(listId, {
            tasks: tasks.filter(task => !this.deletedTaskIds.has(task.id)),
            allLoaded,
            updatedAt: Date.now(),
            loadingAll: existing?.loadingAll,
        });
        this.scheduleCachePersist();
    }

    upsertTaskInCache(listId: string, task: TodoTask) {
        if (this.deletedTaskIds.has(task.id)) return;
        const entry = this.taskCache.get(listId);
        if (!entry) {
            this.setTaskCache(listId, [task], false);
            return;
        }

        const exists = entry.tasks.some((item) => item.id === task.id);
        entry.tasks = exists
            ? entry.tasks.map((item) => item.id === task.id ? task : item)
            : [task, ...entry.tasks];
        entry.updatedAt = Date.now();
        this.scheduleCachePersist();
    }

    removeTaskFromCache(listId: string, taskId: string) {
        const entry = this.taskCache.get(listId);
        if (!entry) return;
        entry.tasks = entry.tasks.filter((task) => task.id !== taskId);
        entry.updatedAt = Date.now();
        this.scheduleCachePersist();
    }

    scheduleCachePersist() {
        if (!this.plugin.session.signedIn) return;
        if (this.cachePersistTimer !== null) window.clearTimeout(this.cachePersistTimer);
        this.cachePersistTimer = window.setTimeout(() => {
            this.cachePersistTimer = null;
            void this.persistTaskCache();
        }, 2000);
    }

    flushTaskCachePersist() {
        if (this.cachePersistTimer === null) return;
        window.clearTimeout(this.cachePersistTimer);
        this.cachePersistTimer = null;
        void this.persistTaskCache();
    }

    async persistTaskCache() {
        if (!this.plugin.session.signedIn || this.cacheSession !== this.plugin.session.version) return;
        const entries: TaskCacheSnapshot['entries'] = {};
        this.taskCache.forEach((entry, listId) => {
            if (entry.tasks.length === 0 && !entry.allLoaded) return;
            entries[listId] = {
                tasks: entry.tasks.filter((task) => !task.id.startsWith('local-')),
                allLoaded: entry.allLoaded,
                updatedAt: entry.updatedAt,
            };
        });

        this.plugin.taskCacheSnapshot = {
            version: 1,
            savedAt: Date.now(),
            lists: this.currentLists,
            entries,
        };

        try {
            await this.plugin.saveSettings();
        } catch (error) {
            console.warn('Microsoft To Do: failed to save task cache', error);
        }
    }

    restoreTaskCache(snapshot: TaskCacheSnapshot): boolean {
        let restoredAny = false;
        Object.keys(snapshot.entries).forEach((listId) => {
            if (this.taskCache.has(listId)) return;
            const entry = snapshot.entries[listId];
            if (!entry) return;
            this.taskCache.set(listId, {
                tasks: entry.tasks,
                allLoaded: entry.allLoaded,
                updatedAt: entry.updatedAt,
            });
            restoredAny = true;
        });
        return restoredAny;
    }

    async refreshListsInBackground(api: MsTodoApi) {
        const mutationVersion = this.listMutationVersion;
        try {
            const freshLists = await api.getTaskLists();
            if (!api.isCurrentSession() || mutationVersion !== this.listMutationVersion) return;
            if (!freshLists || freshLists.length === 0) return;

            const freshIds = new Set(freshLists.map((list) => list.id));
            let cacheChanged = false;
            Array.from(this.taskCache.keys()).forEach((listId) => {
                if (!freshIds.has(listId)) {
                    this.taskCache.delete(listId);
                    cacheChanged = true;
                }
            });

            const listsChanged = JSON.stringify(freshLists) !== JSON.stringify(this.currentLists);
            const previousSelection = this.selectedListId;
            this.currentLists = freshLists;
            this.normalizeSelectedView(freshLists);
            this.updateTaskComposer?.();
            if (listsChanged || cacheChanged) this.scheduleCachePersist();
            if (this.selectedListId !== previousSelection) {
                void this.render();
            }
        } catch (error) {
            console.warn('Microsoft To Do: failed to refresh lists in background', error);
        }
    }

    markTaskRecentlyMutated(taskId: string) {
        this.recentlyMutatedTaskIds.add(taskId);
        window.setTimeout(() => this.recentlyMutatedTaskIds.delete(taskId), 10_000);
    }

    mergeServerTasksWithLocal(listId: string, serverTasks: TodoTask[]): TodoTask[] {
        const current = this.taskCache.get(listId)?.tasks || [];
        const protectedLocal = current.filter((task) =>
            this.pendingTaskIds.has(task.id) || this.recentlyMutatedTaskIds.has(task.id)
            || this.pendingChecklistOrderTaskIds.has(checklistOrderKey(listId, task.id))
            || [...this.pendingChecklistItemIds].some(key => key.startsWith(`${task.id}:`)),
        );
        const protectedIds = new Set(protectedLocal.map((task) => task.id));
        return [
            ...protectedLocal,
            ...serverTasks.filter((task) => !protectedIds.has(task.id)
                && !this.pendingTaskIds.has(task.id) && !this.deletedTaskIds.has(task.id)),
        ];
    }

    async ensureAllTasksLoaded(api: MsTodoApi, listId: string): Promise<TodoTask[]> {
        api.assertCurrentSession();
        const entry = this.taskCache.get(listId);
        if (entry?.allLoaded) return entry.tasks;
        if (entry?.loadingAll) return entry.loadingAll;

        const loading = api.getTasks(listId, true)
            .then((tasks) => {
                api.assertCurrentSession();
                const mergedTasks = this.mergeServerTasksWithLocal(listId, tasks);
                this.taskCache.set(listId, {
                    tasks: mergedTasks,
                    allLoaded: true,
                    updatedAt: Date.now(),
                });
                this.scheduleCachePersist();
                return mergedTasks;
            })
            .finally(() => {
                const current = this.taskCache.get(listId);
                if (api.isCurrentSession() && current?.loadingAll === loading) current.loadingAll = undefined;
            });

        if (entry) entry.loadingAll = loading;
        else {
            this.taskCache.set(listId, {
                tasks: [],
                allLoaded: false,
                updatedAt: 0,
                loadingAll: loading,
            });
        }
        return loading;
    }

    collectSmartTasks(lists: TodoList[], viewId = this.selectedListId): TodoTask[] {
        this.taskListByTaskId.clear();
        const tasks: TodoTask[] = [];
        for (const list of lists) {
            for (const task of this.taskCache.get(list.id)?.tasks || []) {
                const included = viewId === PLANNED_VIEW_ID ? isPlannedTask(task) : task.status === 'completed';
                if (!included) continue;
                this.taskListByTaskId.set(task.id, list);
                tasks.push(task);
            }
        }
        if (viewId === COMPLETED_VIEW_ID) {
            tasks.sort((a, b) => (b.completedDateTime?.dateTime || '').localeCompare(a.completedDateTime?.dateTime || ''));
        }
        return tasks;
    }

    async warmAllListCaches(api: MsTodoApi, lists: TodoList[]) {
        const missingLists = lists.filter((list) => !this.taskCache.has(list.id));
        if (missingLists.length === 0) return;
        await Promise.all(missingLists.map(async (list) => {
            const tasks = await api.getTasks(list.id, false);
            api.assertCurrentSession();
            this.setTaskCache(list.id, tasks, false);
        }));
    }

    async refreshCachedList(api: MsTodoApi, list: TodoList, listArea: HTMLElement, detail: HTMLElement) {
        const token = this.viewTransitionToken;
        const entry = this.taskCache.get(list.id);
        if (!entry || Date.now() - entry.updatedAt < TASK_CACHE_TTL_MS) return;
        if (this.pendingTaskIds.size > 0) return;

        try {
            const serverTasks = await api.getTasks(list.id, entry.allLoaded);
            if (!api.isCurrentSession()) return;
            const tasks = this.mergeServerTasksWithLocal(list.id, serverTasks);
            this.setTaskCache(list.id, tasks, entry.allLoaded);
            if (token === this.viewTransitionToken && !this.isSearchMode() && this.selectedListId === list.id) {
                this.currentTasks = tasks;
                this.renderTaskList(api, list, listArea, detail);
            }
        } catch (error) {
            console.warn('Microsoft To Do: failed to refresh lists in background', error);
        }
    }

    handleExternalTaskCreated(task: TodoTask, list: TodoList) {
        this.upsertTaskInCache(list.id, task);
        this.markTaskRecentlyMutated(task.id);
        if (this.isSearchMode()) return;
        if (this.selectedListId === list.id) {
            this.taskListByTaskId.set(task.id, list);
            this.currentTasks = [task, ...this.currentTasks.filter(item => item.id !== task.id)];
        } else if (this.selectedListId === PLANNED_VIEW_ID) {
            this.currentTasks = this.collectSmartTasks(this.currentLists);
        } else {
            return;
        }
        if (this.mainListArea && this.mainDetail) {
            this.renderTaskList(new MsTodoApi(this.plugin), this.currentRenderList, this.mainListArea, this.mainDetail);
        }
    }

    async loadPlannedView(api: MsTodoApi, main: HTMLElement, lists: TodoList[], token = this.viewTransitionToken) {
        await this.warmAllListCaches(api, lists);
        if (!api.isCurrentSession() || token !== this.viewTransitionToken || this.isSearchMode()) return;
        this.currentTasks = this.collectSmartTasks(lists, PLANNED_VIEW_ID);
        this.renderTaskArea(api, main, null);
        void this.refreshSmartViewInBackground(api, lists, PLANNED_VIEW_ID, null, this.mainListArea!, this.mainDetail!);
    }

    async loadCompletedView(api: MsTodoApi, main: HTMLElement, lists: TodoList[], token = this.viewTransitionToken) {
        await Promise.all(lists.map(list => this.ensureAllTasksLoaded(api, list.id)));
        if (!api.isCurrentSession() || token !== this.viewTransitionToken || this.isSearchMode()) return;
        this.currentTasks = this.collectSmartTasks(lists, COMPLETED_VIEW_ID);
        this.renderTaskArea(api, main, null);
        void this.refreshSmartViewInBackground(api, lists, COMPLETED_VIEW_ID, null, this.mainListArea!, this.mainDetail!);
    }

    renderTaskArea(api: MsTodoApi, main: HTMLElement, list: TodoList | null) {
        main.empty();
        this.mainListArea = main.createDiv({ cls: 'todo-task-list-area' });
        this.mainDetail = main.createDiv({ cls: 'todo-detail-panel' });
        this.currentRenderList = list;
        this.renderTaskList(api, list, this.mainListArea, this.mainDetail);
    }

    async refreshSmartViewInBackground(
        api: MsTodoApi,
        lists: TodoList[],
        viewId: string,
        renderList: TodoList | null,
        listArea: HTMLElement,
        detail: HTMLElement,
    ) {
        const token = this.viewTransitionToken;
        const stale = lists.filter((list) => {
            const entry = this.taskCache.get(list.id);
            if (entry?.loadingAll) return false;
            return !entry || Date.now() - entry.updatedAt >= TASK_CACHE_TTL_MS;
        });
        if (stale.length === 0) return;
        if (this.pendingTaskIds.size > 0) return;

        try {
            await Promise.all(stale.map(async (list) => {
                const entry = this.taskCache.get(list.id);
                const includeCompleted = entry?.allLoaded ?? false;
                const serverTasks = await api.getTasks(list.id, includeCompleted);
                api.assertCurrentSession();
                this.setTaskCache(list.id, this.mergeServerTasksWithLocal(list.id, serverTasks), includeCompleted);
            }));
        } catch (error) {
            console.warn('Microsoft To Do: failed to refresh smart view in background', error);
            return;
        }

        if (!api.isCurrentSession() || token !== this.viewTransitionToken || this.isSearchMode() || this.selectedListId !== viewId) return;
        this.currentTasks = this.collectSmartTasks(lists, viewId);
        this.renderTaskList(api, renderList, listArea, detail);
    }

    async loadTaskList(api: MsTodoApi, main: HTMLElement, list: TodoList, token = this.viewTransitionToken) {
        const cached = this.taskCache.get(list.id);
        let tasks: TodoTask[];

        if (cached) {
            tasks = cached.tasks;
        } else {
            tasks = await api.getTasks(list.id, false);
            if (!api.isCurrentSession()) return;
            this.setTaskCache(list.id, tasks, false);
        }

        if (!api.isCurrentSession() || token !== this.viewTransitionToken) return;

        this.taskListByTaskId.clear();
        tasks.forEach((task) => this.taskListByTaskId.set(task.id, list));
        this.currentTasks = tasks;
        this.renderTaskArea(api, main, list);
        if (cached) void this.refreshCachedList(api, list, this.mainListArea!, this.mainDetail!);
    }

    async toggleTaskCompletionOptimistically(
        api: MsTodoApi,
        list: TodoList,
        listArea: HTMLElement,
        detail: HTMLElement,
        task: TodoTask,
    ) {
        if (!api.isCurrentSession() || this.pendingTaskIds.has(task.id)) return;

        const originalTask: TodoTask = {
            ...task,
            completedDateTime: task.completedDateTime ? { ...task.completedDateTime } : undefined,
        };
        const originalSelectedTaskId = this.selectedTaskId;
        const completing = task.status !== 'completed';
        const optimisticTask: TodoTask = {
            ...task,
            status: completing ? 'completed' : 'notStarted',
            completedDateTime: completing
                ? { dateTime: new Date().toISOString(), timeZone: 'UTC' }
                : undefined,
        };

        this.pendingTaskIds.add(task.id);
        this.markTaskRecentlyMutated(task.id);
        this.replaceTask(optimisticTask, list.id);
        if (this.selectedTaskId === task.id && (completing || this.selectedListId === COMPLETED_VIEW_ID)) {
            this.selectedTaskId = null;
        }
        this.renderTaskList(api, list, listArea, detail);

        try {
            const updatedTask = completing
                ? await api.completeTask(list.id, task.id)
                : await api.reopenTask(list.id, task.id);
            this.pendingTaskIds.delete(task.id);
            this.markTaskRecentlyMutated(task.id);
            this.replaceTask(updatedTask, list.id);
            this.renderTaskList(api, list, listArea, detail);
        } catch (error) {
            if (!api.isCurrentSession()) return;
            this.pendingTaskIds.delete(task.id);
            this.selectedTaskId = originalSelectedTaskId;
            this.replaceTask(originalTask, list.id);
            this.renderTaskList(api, list, listArea, detail);
            new Notice(t('notices.updateTaskFailedReverted'));
            console.error(error);
        }
    }

    renderTaskList(api: MsTodoApi, list: TodoList | null, listArea: HTMLElement, detail: HTMLElement) {
        if (!api.isCurrentSession() || listArea !== this.mainListArea || detail !== this.mainDetail) return;
        this.clearDetailControls();
        listArea.empty();
        detail.empty();
        detail.removeClass('is-open');

        const completed = this.selectedListId === COMPLETED_VIEW_ID;
        const planned = this.selectedListId === PLANNED_VIEW_ID && !this.isSearchMode();
        const tasks = this.currentTasks.filter(task => this.isSearchMode() || (completed ? task.status === 'completed' : task.status !== 'completed'));
        const renderedIds = new Set<string>();
        const renderRows = (items: TodoTask[]) => {
            for (const task of items) {
                const sourceList = this.taskListByTaskId.get(task.id) || list;
                if (!sourceList) continue;
                this.renderTaskRow(api, listArea, detail, sourceList, task);
                renderedIds.add(task.id);
            }
        };

        if (tasks.length === 0) {
            const title = this.isSearchMode() ? t('search.emptyTitle')
                : planned ? t('empty.plannedTitle') : completed ? t('empty.completedTitle') : t('empty.defaultTitle');
            const subtitle = this.isSearchMode() ? t('search.emptySubtitle')
                : planned ? t('empty.plannedSubtitle') : completed ? t('empty.completedSubtitle') : t('empty.defaultSubtitle');
            const empty = listArea.createDiv({ cls: 'todo-empty' });
            empty.createEl('div', { text: title, cls: 'todo-empty-title' });
            empty.createEl('div', { text: subtitle, cls: 'todo-empty-subtitle' });
        } else if (planned) {
            const groups = groupPlannedTasks(tasks);
            const headings = { today: t('date.today'), tomorrow: t('date.tomorrow'), later: t('planned.later') };
            for (const group of ['today', 'tomorrow', 'later'] as const) {
                if (groups[group].length === 0) continue;
                listArea.createDiv({ text: headings[group], cls: 'todo-task-group-heading' });
                renderRows(groups[group]);
            }
            if (groups.earlier.length > 0) {
                const allOverdue = groups.earlier.every(task => isTaskOverdue(task, toLocalDateKey(new Date())));
                const toggle = listArea.createEl('button', { cls: 'todo-earlier-toggle', attr: { type: 'button', 'aria-expanded': String(this.showEarlier) } });
                const icon = toggle.createSpan({ cls: 'todo-earlier-chevron' });
                setIcon(icon, this.showEarlier ? 'chevron-down' : 'chevron-right');
                toggle.createSpan({ text: t(allOverdue ? 'planned.overdueCount' : 'planned.earlierCount', { count: groups.earlier.length }) });
                toggle.onclick = () => {
                    this.showEarlier = !this.showEarlier;
                    this.renderTaskList(api, list, listArea, detail);
                };
                if (this.showEarlier) renderRows(groups.earlier);
            }
        } else if (completed && !this.isSearchMode()) {
            for (const sourceList of this.currentLists) {
                const items = tasks.filter(task => this.taskListByTaskId.get(task.id)?.id === sourceList.id);
                if (items.length === 0) continue;
                listArea.createDiv({ text: sourceList.displayName, cls: 'todo-task-group-heading' });
                renderRows(items);
            }
        } else {
            renderRows(tasks);
        }

        if (this.selectedTaskId) {
            const selectedTask = this.currentTasks.find((task) => task.id === this.selectedTaskId);
            if (selectedTask && renderedIds.has(selectedTask.id)) {
                const sourceList = this.taskListByTaskId.get(selectedTask.id) || list;
                if (sourceList) this.selectTask(api, sourceList, listArea, detail, selectedTask);
            }
        }
    }

    renderTaskRow(api: MsTodoApi, listArea: HTMLElement, detail: HTMLElement, list: TodoList, task: TodoTask) {
        const meta = buildTaskMeta(task);
        const row = listArea.createEl('button', {
            cls: 'todo-task-row',
            attr: { 'data-task-id': task.id },
        });
        row.setAttr('type', 'button');

        if (task.id === this.selectedTaskId) row.addClass('is-selected');
        if (task.status === 'completed') row.addClass('is-completed');
        if (meta?.kind === 'overdue') row.addClass('is-overdue');
        if (this.pendingTaskIds.has(task.id)) {
            row.addClass('is-syncing');
            row.setAttr('aria-busy', 'true');
        }

        const checkboxWrap = row.createSpan({ cls: 'todo-checkbox-wrap' });
        const checkbox = checkboxWrap.createEl('input', { type: 'checkbox', cls: 'todo-task-checkbox' });
        checkbox.checked = task.status === 'completed';
        checkbox.setAttr('aria-label', task.status === 'completed' ? t('taskRow.reopenAria') : t('taskRow.completeAria'));
        checkbox.onclick = (event) => {
            event.stopPropagation();
            void this.toggleTaskCompletionOptimistically(api, list, listArea, detail, task);
        };

        const content = row.createSpan({ cls: 'todo-task-content' });
        content.createSpan({ text: task.title, cls: 'todo-task-title' });

        const metadata = content.createSpan({ cls: 'todo-task-metadata' });
        const aggregate = isSmartViewId(this.selectedListId) || this.isSearchMode();
        if (aggregate && (this.selectedListId !== COMPLETED_VIEW_ID || this.isSearchMode())) {
            metadata.createSpan({ text: list.displayName, cls: 'todo-task-source' });
        }
        const reminderOnly = task.status !== 'completed' && !task.dueDateTime?.dateTime && task.isReminderOn && !!getPlannedDate(task);
        if (meta || reminderOnly) {
            const metaLine = metadata.createSpan({ cls: `todo-task-meta is-${meta?.kind || 'date'}` });
            const metaIcon = metaLine.createSpan({ cls: 'todo-task-meta-icon' });
            setIcon(metaIcon, reminderOnly ? 'bell' : meta?.kind === 'completed' ? 'check' : 'calendar-days');
            metaLine.createSpan({ text: reminderOnly ? t('planned.reminderDate', { date: formatShortDate(getPlannedDate(task)) }) : meta!.text });
        }
        if (task.checklistItems && task.checklistItems.length > 0) {
            const checkedCount = task.checklistItems.filter(item => item.isChecked).length;
            const steps = metadata.createSpan({ cls: 'todo-task-step-count' });
            const icon = steps.createSpan({ cls: 'todo-task-step-icon' });
            setIcon(icon, 'list-checks');
            steps.createSpan({ text: `${checkedCount}/${task.checklistItems.length}` });
        }
        const body = taskBodyText(task.body).trim();
        if (body) content.createSpan({ text: body, cls: 'todo-task-preview' });

        const trailing = row.createSpan({ cls: 'todo-task-trailing' });
        if (this.pendingTaskIds.has(task.id)) {
            const syncing = trailing.createSpan({ cls: 'todo-task-sync-spinner', attr: { 'aria-label': t('taskRow.syncingAria') } });
            setIcon(syncing, 'loader-circle');
        }
        if (task.importance === 'high') {
            const star = trailing.createSpan({ cls: 'todo-star is-important' });
            setIcon(star, 'star');
        }

        row.onclick = () => {
            if (this.pendingTaskIds.has(task.id)) return;
            this.selectTask(api, list, listArea, detail, task);
        };
    }

    clearDetailControls() {
        this.disposeDetailSteps?.();
        this.disposeDetailSteps = undefined;
        this.disposeDetailDatePicker?.();
        this.disposeDetailDatePicker = undefined;
    }

    selectTask(api: MsTodoApi, list: TodoList, listArea: HTMLElement, detail: HTMLElement, task: TodoTask) {
        this.selectedTaskId = task.id;
        listArea.querySelectorAll('.todo-task-row').forEach((row) => {
            row.toggleClass('is-selected', row.getAttr('data-task-id') === task.id);
        });
        renderTaskDetail(this, api, detail, listArea, list, task, this.noteDrafts);
    }

    async confirmAndDeleteTask(
        api: MsTodoApi,
        list: TodoList,
        listArea: HTMLElement,
        detail: HTMLElement,
        task: TodoTask,
    ) {
        if (!api.isCurrentSession() || this.pendingTaskIds.has(task.id)) return;

        const confirmed = await new Promise<boolean>((resolve) => {
            new DeleteConfirmModal(this.app, {
                title: t('modal.deleteTaskTitle'),
                message: t('modal.deleteTaskMessage', { taskTitle: task.title }),
            }, resolve).open();
        });
        if (!confirmed || !api.isCurrentSession()) return;

        const previousCurrentTasks = [...this.currentTasks];
        const previousSelectedTaskId = this.selectedTaskId;
        const cacheEntry = this.taskCache.get(list.id);
        const previousCacheTasks = cacheEntry ? [...cacheEntry.tasks] : null;

        // Keep this marker after success so earlier edits and refreshes cannot restore the task.
        this.deletedTaskIds.add(task.id);
        this.pendingTaskIds.add(task.id);
        this.currentTasks = this.currentTasks.filter((item) => item.id !== task.id);
        this.removeTaskFromCache(list.id, task.id);
        this.taskListByTaskId.delete(task.id);
        this.selectedTaskId = null;
        detail.empty();
        detail.removeClass('is-open');
        this.renderTaskList(api, isSmartViewId(this.selectedListId) ? null : list, listArea, detail);

        try {
            await api.deleteTask(list.id, task.id);
            if (!api.isCurrentSession()) return;
            this.noteDrafts.delete(task.id);
            this.pendingTaskIds.delete(task.id);
            this.removeTaskFromCache(list.id, task.id);
            this.taskListByTaskId.delete(task.id);
            new Notice(t('notices.taskDeleted'));
        } catch (error) {
            if (!api.isCurrentSession()) return;
            this.deletedTaskIds.delete(task.id);
            this.pendingTaskIds.delete(task.id);
            this.currentTasks = previousCurrentTasks;
            this.selectedTaskId = previousSelectedTaskId;
            if (cacheEntry && previousCacheTasks) {
                cacheEntry.tasks = previousCacheTasks;
                cacheEntry.updatedAt = Date.now();
            } else {
                this.upsertTaskInCache(list.id, task);
            }
            this.taskListByTaskId.set(task.id, list);
            this.renderTaskList(api, isSmartViewId(this.selectedListId) ? null : list, listArea, detail);
            new Notice(t('notices.deleteTaskFailedReverted'));
            console.error(error);
        }
    }

    async saveTaskChange(
        api: MsTodoApi,
        list: TodoList,
        listArea: HTMLElement,
        detail: HTMLElement,
        task: TodoTask,
        update: () => Promise<TodoTask>,
        successMessage: string,
    ) {
        if (!api.isCurrentSession() || this.deletedTaskIds.has(task.id)) return;
        try {
            const updatedTask = await update();
            if (!api.isCurrentSession() || this.deletedTaskIds.has(task.id)) return;
            this.markTaskRecentlyMutated(updatedTask.id || task.id);
            this.replaceTask(updatedTask, list.id);
            this.selectedTaskId = this.currentTasks.some(item => item.id === updatedTask.id) ? updatedTask.id : null;
            new Notice(successMessage);
            this.renderTaskList(api, list, listArea, detail);
        } catch (error) {
            if (!api.isCurrentSession() || this.deletedTaskIds.has(task.id)) return;
            new Notice(t('notices.updateTaskFailed'));
            console.error(error);
        }
    }

    replaceTask(updatedTask: TodoTask, listId?: string) {
        if (this.deletedTaskIds.has(updatedTask.id)) return;
        if (listId) this.upsertTaskInCache(listId, updatedTask);
        const belongs = this.isSearchMode()
            ? updatedTask.title.toLowerCase().includes(this.searchQuery.trim().toLowerCase())
            : this.selectedListId === PLANNED_VIEW_ID ? isPlannedTask(updatedTask)
            : this.selectedListId === COMPLETED_VIEW_ID ? updatedTask.status === 'completed'
            : !listId || listId === this.selectedListId;
        if (!belongs) {
            this.currentTasks = this.currentTasks.filter(task => task.id !== updatedTask.id);
            this.taskListByTaskId.delete(updatedTask.id);
            if (this.selectedTaskId === updatedTask.id) this.selectedTaskId = null;
            return;
        }
        const list = this.currentLists.find(item => item.id === listId);
        if (list) this.taskListByTaskId.set(updatedTask.id, list);
        this.currentTasks = this.currentTasks.some(task => task.id === updatedTask.id)
            ? this.currentTasks.map(task => task.id === updatedTask.id ? updatedTask : task)
            : [updatedTask, ...this.currentTasks];
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
