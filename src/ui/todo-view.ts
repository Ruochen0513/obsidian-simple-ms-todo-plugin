import { App, ItemView, Menu, Modal, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import type MsTodoPlugin from '../main';
import { MsTodoApi, ChecklistItem, TodoList, TodoTask } from '../api/ms-todo-api';

export const VIEW_TYPE_TODO = 'ms-todo-view';
const MY_DAY_VIEW_ID = '__my-day__';
const OVERDUE_VIEW_ID = '__overdue__';

function isSmartViewId(id: string | null): boolean {
    return id === MY_DAY_VIEW_ID || id === OVERDUE_VIEW_ID;
}

type MetaKind = 'today' | 'tomorrow' | 'overdue' | 'date' | 'completed';

interface TaskMeta {
    text: string;
    kind: MetaKind;
}

export interface TaskCacheEntry {
    tasks: TodoTask[];
    allLoaded: boolean;
    updatedAt: number;
    loadingAll?: Promise<TodoTask[]>;
}

export interface TaskCacheSnapshot {
    version: 1;
    savedAt: number;
    lists: TodoList[];
    entries: Record<string, { tasks: TodoTask[]; allLoaded: boolean; updatedAt: number }>;
}

const TASK_CACHE_TTL_MS = 30_000;

export class TodoView extends ItemView {
    plugin: MsTodoPlugin;
    selectedListId: string | null = MY_DAY_VIEW_ID;
    selectedTaskId: string | null = null;
    showCompleted = false;
    currentTasks: TodoTask[] = [];
    currentLists: TodoList[] = [];
    viewTransitionToken = 0;
    taskListByTaskId = new Map<string, TodoList>();
    taskCache = new Map<string, TaskCacheEntry>();
    pendingTaskIds = new Set<string>();
    recentlyMutatedTaskIds = new Set<string>();
    mainListArea: HTMLElement | null = null;
    mainDetail: HTMLElement | null = null;
    currentRenderList: TodoList | null = null;
    cachePersistTimer: number | null = null;
    searchQuery = '';
    searchInputEl: HTMLInputElement | null = null;
    searchHostEl: HTMLElement | null = null;
    searchToggleFn: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: MsTodoPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_TODO; }
    getDisplayText() { return 'Microsoft To Do'; }
    getIcon() { return 'check-square'; }

    async onOpen() {
        await this.render();
    }

    async onClose() {
        this.flushTaskCachePersist();
    }

    async render() {
        this.viewTransitionToken++;
        this.searchQuery = '';
        this.searchInputEl = null;
        this.searchHostEl = null;
        this.searchToggleFn = null;
        const container = this.contentEl;
        container.empty();
        container.addClass('ms-todo-container');

        if (!this.plugin.settings.accessToken) {
            this.taskCache.clear();
            this.currentLists = [];
            this.currentTasks = [];
            this.taskListByTaskId.clear();
            this.mainListArea = null;
            this.mainDetail = null;
            this.currentRenderList = null;
            this.renderSignedOut(container);
            return;
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
        loading.createSpan({ text: '正在加载 Microsoft To Do…' });

        try {
            const api = new MsTodoApi(this.plugin);
            const lists = await api.getTaskLists();

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
            loading.empty();
            loading.addClass('todo-error');
            loading.createSpan({ text: '加载失败' });
            container.createEl('div', { text: String(error), cls: 'todo-error-detail' });
            console.error(error);
        }
    }

    renderSignedOut(container: HTMLElement) {
        const hero = container.createDiv({ cls: 'todo-signed-out' });
        const icon = hero.createDiv({ cls: 'todo-signed-out-icon' });
        setIcon(icon, 'check-check');
        hero.createEl('h3', { text: 'Microsoft To Do' });
        hero.createEl('p', { text: '登录后可直接在 Obsidian 中查看和管理 Microsoft To Do。' });
        const loginBtn = hero.createEl('button', { text: '登录 Microsoft To Do', cls: 'todo-primary-button' });
        loginBtn.onclick = () => this.plugin.login();
    }

    renderEmptyLists(container: HTMLElement, api: MsTodoApi) {
        const hero = container.createDiv({ cls: 'todo-signed-out' });
        const icon = hero.createDiv({ cls: 'todo-signed-out-icon' });
        setIcon(icon, 'list-plus');
        hero.createEl('h3', { text: '创建第一个清单' });
        hero.createEl('p', { text: 'Microsoft To Do 中还没有可用清单。' });
        const createBtn = hero.createEl('button', { text: '新建清单', cls: 'todo-primary-button' });
        createBtn.onclick = () => { void this.promptCreateList(api); };
    }

    normalizeSelectedView(lists: TodoList[]) {
        if (isSmartViewId(this.selectedListId)) return;
        if (this.selectedListId && lists.some((list) => list.id === this.selectedListId)) return;
        this.selectedListId = MY_DAY_VIEW_ID;
    }

    getSelectedList(lists: TodoList[]): TodoList | null {
        if (!this.selectedListId || isSmartViewId(this.selectedListId)) return null;
        return lists.find((list) => list.id === this.selectedListId) || null;
    }

    async renderShell(api: MsTodoApi, container: HTMLElement, lists: TodoList[]) {
        const app = container.createDiv({ cls: 'todo-app-shell' });

        const header = app.createDiv({ cls: 'todo-header' });
        const brand = header.createDiv({ cls: 'todo-brand' });
        const brandIcon = brand.createSpan({ cls: 'todo-brand-icon' });
        setIcon(brandIcon, 'check-check');
        brand.createSpan({ text: 'Microsoft To Do', cls: 'todo-brand-text' });

        const selectedList = this.getSelectedList(lists);
        const actions = header.createDiv({ cls: 'todo-header-actions' });
        this.createIconButton(actions, 'rotate-cw', '刷新', () => { void this.render(); });
        this.createIconButton(actions, 'search', '搜索任务', () => { this.searchToggleFn?.(); });
        this.createIconButton(actions, 'more-vertical', '更多', (event) => {
            this.showMoreMenu(event, api, this.getSelectedList(this.currentLists));
        });

        const selectorHost = app.createDiv({ cls: 'todo-view-selector-host' });
        const main = app.createDiv({ cls: 'todo-main-panel' });
        this.renderViewSelector(api, selectorHost, lists, main);
        this.renderSearchBar(api, selectorHost, main, lists);
        this.renderTaskSkeleton(main);

        if (this.selectedListId === OVERDUE_VIEW_ID) {
            await this.loadOverdueView(api, main, lists);
        } else if (this.selectedListId === MY_DAY_VIEW_ID) {
            await this.loadMyDay(api, main, lists);
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
        const wrapper = parent.createDiv({ cls: 'todo-view-selector-wrap' });
        const selector = wrapper.createEl('button', { cls: 'todo-view-selector' });
        selector.setAttr('type', 'button');
        selector.setAttr('aria-expanded', 'false');

        const selectorIcon = selector.createSpan({ cls: 'todo-view-selector-icon' });
        const label = selector.createSpan({ cls: 'todo-view-selector-label' });
        const chevron = selector.createSpan({ cls: 'todo-view-selector-chevron' });
        setIcon(chevron, 'chevron-down');

        const updateSelector = () => {
            selectorIcon.empty();
            if (isSmartViewId(this.selectedListId)) {
                const isOverdue = this.selectedListId === OVERDUE_VIEW_ID;
                setIcon(selectorIcon, isOverdue ? 'calendar-clock' : 'sun');
                label.setText(isOverdue ? '逾期' : '我的一天');
                selector.setAttr('aria-label', `当前视图：${isOverdue ? '逾期' : '我的一天'}`);
                return;
            }

            const list = this.getSelectedList(lists);
            setIcon(selectorIcon, 'list');
            label.setText(list?.displayName || '任务');
            selector.setAttr('aria-label', `当前清单：${list?.displayName || '任务'}`);
        };

        updateSelector();

        const panel = wrapper.createDiv({ cls: 'todo-list-menu' });
        panel.setAttr('role', 'menu');
        panel.setAttr('aria-label', '切换视图或清单');

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
            this.showCompleted = false;
            updateSelector();
            renderMenuItems();
            const loader = viewId === OVERDUE_VIEW_ID
                ? (token: number) => this.loadOverdueView(api, main, lists, token)
                : (token: number) => this.loadMyDay(api, main, lists, token);
            void this.transitionToView(api, main, loader);
        };

        const switchToList = (list: TodoList) => {
            closeMenu();
            if (list.id === this.selectedListId) return;
            this.clearSearchState();
            this.selectedListId = list.id;
            this.selectedTaskId = null;
            this.showCompleted = false;
            updateSelector();
            renderMenuItems();
            void this.transitionToView(api, main, (token) => this.loadTaskList(api, main, list, token));
        };

        const renderMenuItems = () => {
            panel.empty();

            panel.createDiv({ text: '智能视图', cls: 'todo-list-menu-section-label' });
            const smartViews: Array<{ id: string; label: string; icon: string }> = [
                { id: MY_DAY_VIEW_ID, label: '我的一天', icon: 'sun' },
                { id: OVERDUE_VIEW_ID, label: '逾期', icon: 'calendar-clock' },
            ];
            smartViews.forEach((view) => {
                const item = panel.createEl('button', { cls: 'todo-list-menu-item todo-smart-view-item' });
                item.setAttr('type', 'button');
                item.setAttr('role', 'menuitem');
                if (this.selectedListId === view.id) item.addClass('is-active');
                const icon = item.createSpan({ cls: 'todo-list-menu-item-icon' });
                setIcon(icon, this.selectedListId === view.id ? 'check' : view.icon);
                item.createSpan({ text: view.label, cls: 'todo-list-menu-item-label' });
                if (view.id === OVERDUE_VIEW_ID) {
                    const overdueCount = this.getOverdueCount();
                    if (overdueCount !== null && overdueCount > 0) {
                        item.createSpan({ text: String(overdueCount), cls: 'todo-list-menu-item-count', attr: { 'aria-label': '条逾期任务' } });
                    }
                }
                item.onclick = () => switchToSmartView(view.id);
            });

            panel.createDiv({ cls: 'todo-list-menu-separator' });
            panel.createDiv({ text: '清单', cls: 'todo-list-menu-section-label' });

            lists.forEach((list) => {
                const item = panel.createEl('button', { cls: 'todo-list-menu-item' });
                item.setAttr('type', 'button');
                item.setAttr('role', 'menuitem');
                item.setAttr('data-list-id', list.id);
                if (list.id === this.selectedListId) item.addClass('is-active');

                const icon = item.createSpan({ cls: 'todo-list-menu-item-icon' });
                setIcon(icon, list.id === this.selectedListId ? 'check' : 'list');
                item.createSpan({ text: list.displayName, cls: 'todo-list-menu-item-label' });
                item.onclick = () => switchToList(list);
            });

            panel.createDiv({ cls: 'todo-list-menu-separator' });
            const createItem = panel.createEl('button', { cls: 'todo-list-menu-item todo-list-menu-create' });
            createItem.setAttr('type', 'button');
            createItem.setAttr('role', 'menuitem');
            const plusIcon = createItem.createSpan({ cls: 'todo-list-menu-item-icon' });
            setIcon(plusIcon, 'plus');
            createItem.createSpan({ text: '新建清单', cls: 'todo-list-menu-item-label' });
            createItem.onclick = () => {
                closeMenu();
                void this.promptCreateList(api);
            };
        };

        renderMenuItems();

        selector.onclick = (event) => {
            event.stopPropagation();
            const nextOpen = !wrapper.hasClass('is-open');
            if (nextOpen) {
                renderMenuItems();
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
        this.registerDomEvent(document, 'click', outsideClick);
    }

    isSearchMode(): boolean {
        return this.searchQuery.trim().length > 0;
    }

    clearSearchState() {
        this.searchQuery = '';
        if (this.searchInputEl) this.searchInputEl.value = '';
    }

    renderSearchBar(api: MsTodoApi, host: HTMLElement, main: HTMLElement, lists: TodoList[]) {
        this.searchHostEl = host;
        const bar = host.createDiv({ cls: 'todo-search-bar' });
        const icon = bar.createSpan({ cls: 'todo-search-icon' });
        setIcon(icon, 'search');
        const input = bar.createEl('input', { cls: 'todo-search-input' });
        input.setAttr('type', 'text');
        input.setAttr('placeholder', '搜索全部任务…');
        input.setAttr('aria-label', '搜索全部任务');
        this.searchInputEl = input;

        const clearBtn = bar.createEl('button', { cls: 'todo-search-clear' });
        clearBtn.setAttr('type', 'button');
        clearBtn.setAttr('aria-label', '清空搜索内容');
        const clearIcon = clearBtn.createSpan();
        setIcon(clearIcon, 'x');

        const open = () => {
            host.addClass('is-searching');
            input.focus();
        };
        const close = () => {
            const hadResults = this.isSearchMode();
            input.value = '';
            this.searchQuery = '';
            clearBtn.removeClass('is-visible');
            host.removeClass('is-searching');
            input.blur();
            if (hadResults) void this.restoreFromSearch(api, main, lists);
        };
        this.searchToggleFn = () => {
            if (host.hasClass('is-searching')) close();
            else open();
        };

        this.registerDomEvent(document, 'click', (event: MouseEvent) => {
            if (host !== this.searchHostEl) return;
            if (!host.hasClass('is-searching')) return;
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (target.closest('.todo-search-bar, .todo-header, .todo-task-row, .todo-detail-panel, .todo-add-composer, .todo-completed-heading')) return;
            close();
        });

        let searchTimer: number | null = null;
        const applySearch = (value: string) => {
            if (searchTimer !== null) window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => {
                searchTimer = null;
                const hadResults = this.isSearchMode();
                this.searchQuery = value;
                clearBtn.toggleClass('is-visible', value.length > 0);
                if (this.isSearchMode()) {
                    void this.runSearch(api, main, lists);
                } else if (hadResults) {
                    void this.restoreFromSearch(api, main, lists);
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
        const query = this.searchQuery.trim().toLowerCase();
        await this.warmAllListCaches(api, lists);
        if (this.searchQuery.trim().toLowerCase() !== query) return;

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
        main.empty();
        const listArea = main.createDiv({ cls: 'todo-task-list-area' });
        const detail = main.createDiv({ cls: 'todo-detail-panel' });
        this.mainListArea = listArea;
        this.mainDetail = detail;
        this.currentRenderList = null;
        this.renderTaskList(api, null, listArea, detail);
    }

    async restoreFromSearch(api: MsTodoApi, main: HTMLElement, lists: TodoList[]) {
        if (this.selectedListId === OVERDUE_VIEW_ID) {
            await this.loadOverdueView(api, main, lists);
        } else if (this.selectedListId === MY_DAY_VIEW_ID) {
            await this.loadMyDay(api, main, lists);
        } else {
            const list = this.getSelectedList(lists);
            if (list) await this.loadTaskList(api, main, list);
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
            state.createSpan({ text: '加载视图失败' });
            console.error(error);
        }
    }

    renderTaskSkeleton(main: HTMLElement) {
        main.empty();
        const skeleton = main.createDiv({ cls: 'todo-list-skeleton', attr: { 'aria-label': '正在加载清单' } });

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
                    .setTitle('同步到笔记')
                    .setIcon('file-down')
                    .onClick(() => { void this.plugin.syncTasksToMarkdown(); });
            });
        }

        if (selectedList && selectedList.wellknownListName !== 'defaultList') {
            menu.addItem((item) => {
                item
                    .setTitle('删除当前清单')
                    .setIcon('trash-2')
                    .onClick(() => { void this.deleteList(api, selectedList); });
            });
        }

        menu.addSeparator();
        menu.addItem((item) => {
            item
                .setTitle('退出登录')
                .setIcon('log-out')
                .onClick(async () => {
                    await this.plugin.clearData();
                    void this.render();
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

    async promptCreateList(api: MsTodoApi) {
        const displayName = await new Promise<string | null>((resolve) => {
            new CreateListModal(this.app, resolve).open();
        });
        if (!displayName) return;
        await this.createList(api, displayName);
    }

    async createList(api: MsTodoApi, displayName: string) {
        const name = displayName.trim();
        if (!name) return;

        try {
            const list = await api.createTaskList(name);
            this.selectedListId = list.id;
            this.selectedTaskId = null;
            this.showCompleted = false;
            new Notice('清单已创建');
            await this.render();
        } catch (error) {
            new Notice('创建清单失败');
            console.error(error);
        }
    }

    async deleteList(api: MsTodoApi, list: TodoList) {
        const confirmed = await new Promise<boolean>((resolve) => {
            new DeleteConfirmModal(this.app, {
                title: '删除清单？',
                before: '将删除清单“',
                bold: list.displayName,
                after: '”及其中所有任务，删除后无法恢复。',
            }, resolve).open();
        });
        if (!confirmed) return;

        try {
            await api.deleteTaskList(list.id);
            this.taskCache.delete(list.id);
            this.scheduleCachePersist();
            if (this.selectedListId === list.id) {
                this.selectedListId = MY_DAY_VIEW_ID;
                this.selectedTaskId = null;
            }
            this.showCompleted = false;
            new Notice('清单已删除');
            await this.render();
        } catch (error) {
            new Notice('删除清单失败');
            console.error(error);
        }
    }

    getTaskCache(listId: string): TaskCacheEntry | null {
        return this.taskCache.get(listId) || null;
    }

    setTaskCache(listId: string, tasks: TodoTask[], allLoaded: boolean) {
        const existing = this.taskCache.get(listId);
        this.taskCache.set(listId, {
            tasks,
            allLoaded,
            updatedAt: Date.now(),
            loadingAll: existing?.loadingAll,
        });
        this.scheduleCachePersist();
    }

    upsertTaskInCache(listId: string, task: TodoTask) {
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
            console.warn('保存任务缓存失败', error);
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
        try {
            const freshLists = await api.getTaskLists();
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
            if (listsChanged || cacheChanged) this.scheduleCachePersist();
            if (this.selectedListId !== previousSelection) {
                void this.render();
            }
        } catch (error) {
            console.warn('后台刷新清单失败', error);
        }
    }

    markTaskRecentlyMutated(taskId: string) {
        this.recentlyMutatedTaskIds.add(taskId);
        window.setTimeout(() => this.recentlyMutatedTaskIds.delete(taskId), 10_000);
    }

    mergeServerTasksWithLocal(listId: string, serverTasks: TodoTask[]): TodoTask[] {
        const current = this.taskCache.get(listId)?.tasks || [];
        const protectedLocal = current.filter((task) =>
            this.pendingTaskIds.has(task.id) || this.recentlyMutatedTaskIds.has(task.id),
        );
        const protectedIds = new Set(protectedLocal.map((task) => task.id));
        return [
            ...protectedLocal,
            ...serverTasks.filter((task) => !protectedIds.has(task.id) && !this.pendingTaskIds.has(task.id)),
        ];
    }

    async ensureAllTasksLoaded(api: MsTodoApi, listId: string): Promise<TodoTask[]> {
        const entry = this.taskCache.get(listId);
        if (entry?.allLoaded) return entry.tasks;
        if (entry?.loadingAll) return entry.loadingAll;

        const loading = api.getTasks(listId, true)
            .then((tasks) => {
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
                if (current) current.loadingAll = undefined;
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

    collectMyDayTasks(lists: TodoList[]): TodoTask[] {
        const today = toLocalDateKey(new Date());
        this.taskListByTaskId.clear();
        const tasks: TodoTask[] = [];

        lists.forEach((list) => {
            const entry = this.taskCache.get(list.id);
            if (!entry) return;
            entry.tasks.forEach((task) => {
                if (!isTaskDueOn(task, today)) return;
                this.taskListByTaskId.set(task.id, list);
                tasks.push(task);
            });
        });

        return tasks;
    }

    collectOverdueTasks(lists: TodoList[]): TodoTask[] {
        const today = toLocalDateKey(new Date());
        this.taskListByTaskId.clear();
        const tasks: TodoTask[] = [];

        lists.forEach((list) => {
            const entry = this.taskCache.get(list.id);
            if (!entry) return;
            entry.tasks.forEach((task) => {
                if (!isTaskOverdue(task, today)) return;
                this.taskListByTaskId.set(task.id, list);
                tasks.push(task);
            });
        });

        tasks.sort((a, b) => {
            const aDue = dateToInputValue(a.dueDateTime?.dateTime || '');
            const bDue = dateToInputValue(b.dueDateTime?.dateTime || '');
            if (aDue !== bDue) return aDue < bDue ? -1 : 1;
            const aImportant = a.importance === 'high' ? 1 : 0;
            const bImportant = b.importance === 'high' ? 1 : 0;
            return bImportant - aImportant;
        });

        return tasks;
    }

    async warmAllListCaches(api: MsTodoApi, lists: TodoList[]) {
        const missingLists = lists.filter((list) => !this.taskCache.has(list.id));
        if (missingLists.length === 0) return;
        await Promise.all(missingLists.map(async (list) => {
            const tasks = await api.getTasks(list.id, false);
            this.setTaskCache(list.id, tasks, false);
        }));
    }

    getOverdueCount(): number | null {
        if (this.currentLists.length === 0) return null;
        const allCached = this.currentLists.every((list) => this.taskCache.has(list.id));
        if (!allCached) return null;
        const today = toLocalDateKey(new Date());
        let count = 0;
        this.currentLists.forEach((list) => {
            this.taskCache.get(list.id)?.tasks.forEach((task) => {
                if (task.status !== 'completed' && isTaskOverdue(task, today)) count++;
            });
        });
        return count;
    }

    isCompletedDataReady(list: TodoList | null): boolean {
        if (isSmartViewId(this.selectedListId)) {
            return this.currentLists.every((item) => this.taskCache.get(item.id)?.allLoaded === true);
        }
        return !!list && this.taskCache.get(list.id)?.allLoaded === true;
    }

    async preloadCompletedData(api: MsTodoApi, list: TodoList | null) {
        try {
            if (isSmartViewId(this.selectedListId)) {
                await Promise.all(this.currentLists.map((item) => this.ensureAllTasksLoaded(api, item.id)));
                if (this.selectedListId === MY_DAY_VIEW_ID) {
                    this.currentTasks = this.collectMyDayTasks(this.currentLists);
                } else if (this.selectedListId === OVERDUE_VIEW_ID) {
                    this.currentTasks = this.collectOverdueTasks(this.currentLists);
                }
                return;
            }

            if (!list) return;
            const tasks = await this.ensureAllTasksLoaded(api, list.id);
            if (this.selectedListId === list.id) this.currentTasks = tasks;
        } catch (error) {
            console.warn('预加载已完成任务失败', error);
        }
    }

    async refreshCachedList(api: MsTodoApi, list: TodoList, listArea: HTMLElement, detail: HTMLElement) {
        const entry = this.taskCache.get(list.id);
        if (!entry || Date.now() - entry.updatedAt < TASK_CACHE_TTL_MS) return;
        if (this.pendingTaskIds.size > 0) return;

        try {
            const serverTasks = await api.getTasks(list.id, entry.allLoaded);
            const tasks = this.mergeServerTasksWithLocal(list.id, serverTasks);
            this.setTaskCache(list.id, tasks, entry.allLoaded);
            if (this.selectedListId === list.id) {
                this.currentTasks = tasks;
                this.renderTaskList(api, list, listArea, detail);
            }
        } catch (error) {
            console.warn('后台刷新清单失败', error);
        }
    }

    handleExternalTaskCreated(task: TodoTask, list: TodoList, dueToday: boolean) {
        this.upsertTaskInCache(list.id, task);
        this.markTaskRecentlyMutated(task.id);

        if (this.isSearchMode()) return;

        if (this.selectedListId === list.id) {
            this.taskListByTaskId.set(task.id, list);
            this.currentTasks = [task, ...this.currentTasks];
        } else if (this.selectedListId === MY_DAY_VIEW_ID && dueToday) {
            this.currentTasks = this.collectMyDayTasks(this.currentLists);
        } else {
            return;
        }

        if (this.mainListArea && this.mainDetail) {
            this.renderTaskList(new MsTodoApi(this.plugin), this.currentRenderList, this.mainListArea, this.mainDetail);
        }
    }

    createOptimisticTask(title: string, dueDate?: string): TodoTask {
        const now = new Date().toISOString();
        return {
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title,
            status: 'notStarted',
            importance: 'normal',
            createdDateTime: now,
            dueDateTime: dueDate ? { dateTime: `${dueDate}T00:00:00`, timeZone: 'UTC' } : undefined,
        };
    }

    replaceTemporaryTask(tempId: string, realTask: TodoTask, list: TodoList) {
        this.pendingTaskIds.delete(tempId);
        this.markTaskRecentlyMutated(realTask.id);
        this.currentTasks = this.currentTasks.map((task) => task.id === tempId ? realTask : task);
        const entry = this.taskCache.get(list.id);
        if (entry) {
            entry.tasks = entry.tasks.map((task) => task.id === tempId ? realTask : task);
            entry.updatedAt = Date.now();
        } else {
            this.setTaskCache(list.id, [realTask], false);
        }
        this.taskListByTaskId.delete(tempId);
        this.taskListByTaskId.set(realTask.id, list);
        if (this.selectedTaskId === tempId) this.selectedTaskId = realTask.id;
        this.scheduleCachePersist();
    }

    removeOptimisticTask(tempId: string, listId: string) {
        this.pendingTaskIds.delete(tempId);
        this.currentTasks = this.currentTasks.filter((task) => task.id !== tempId);
        this.removeTaskFromCache(listId, tempId);
        this.taskListByTaskId.delete(tempId);
        if (this.selectedTaskId === tempId) this.selectedTaskId = null;
    }

    async loadMyDay(api: MsTodoApi, main: HTMLElement, lists: TodoList[], token?: number) {
        const today = toLocalDateKey(new Date());
        await this.warmAllListCaches(api, lists);

        if (token !== undefined && token !== this.viewTransitionToken) return;

        this.currentTasks = this.collectMyDayTasks(lists);
        main.empty();

        const listArea = main.createDiv({ cls: 'todo-task-list-area' });
        const detail = main.createDiv({ cls: 'todo-detail-panel' });
        const defaultList = lists.find((list) => list.wellknownListName === 'defaultList') || lists[0] || null;
        this.mainListArea = listArea;
        this.mainDetail = detail;
        this.currentRenderList = defaultList;

        if (defaultList) {
            const composer = main.createDiv({ cls: 'todo-add-composer' });
            const plus = composer.createSpan({ cls: 'todo-add-icon' });
            setIcon(plus, 'plus');
            const input = composer.createEl('input', {
                cls: 'todo-add-input',
                placeholder: '添加今天的任务',
            });
            input.setAttr('aria-label', `添加今天的任务到 ${defaultList.displayName}`);

            const createTask = () => {
                const taskTitle = input.value.trim();
                if (!taskTitle) return;

                const optimisticTask = this.createOptimisticTask(taskTitle, today);
                this.pendingTaskIds.add(optimisticTask.id);
                this.taskListByTaskId.set(optimisticTask.id, defaultList);
                this.currentTasks = [optimisticTask, ...this.currentTasks];
                this.upsertTaskInCache(defaultList.id, optimisticTask);
                input.value = '';
                this.renderTaskList(api, defaultList, listArea, detail);
                input.focus();

                void (async () => {
                    let created: TodoTask | null = null;
                    try {
                        created = await api.createTask(defaultList.id, taskTitle);
                        const task = await api.updateTaskDueDate(defaultList.id, created.id, today);
                        this.replaceTemporaryTask(optimisticTask.id, task, defaultList);
                        this.renderTaskList(api, defaultList, listArea, detail);
                    } catch (error) {
                        this.removeOptimisticTask(optimisticTask.id, defaultList.id);
                        if (created) {
                            this.upsertTaskInCache(defaultList.id, created);
                            new Notice('任务已创建，但设置为今天失败，可在“任务”清单中找到');
                        } else {
                            new Notice('添加今天的任务失败');
                            if (!input.value) input.value = taskTitle;
                        }
                        this.renderTaskList(api, defaultList, listArea, detail);
                        console.error(error);
                    }
                })();
            };

            input.addEventListener('keydown', (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    createTask();
                }
            });

            plus.onclick = () => input.focus();
            composer.onclick = (event) => {
                if (event.target === composer) input.focus();
            };
        }

        this.renderTaskList(api, defaultList, listArea, detail);
        void this.preloadCompletedData(api, defaultList);
        void this.refreshSmartViewInBackground(api, lists, MY_DAY_VIEW_ID, defaultList, listArea, detail);
    }

    async loadOverdueView(api: MsTodoApi, main: HTMLElement, lists: TodoList[], token?: number) {
        await this.warmAllListCaches(api, lists);

        if (token !== undefined && token !== this.viewTransitionToken) return;

        this.currentTasks = this.collectOverdueTasks(lists);
        main.empty();

        const listArea = main.createDiv({ cls: 'todo-task-list-area' });
        const detail = main.createDiv({ cls: 'todo-detail-panel' });
        this.mainListArea = listArea;
        this.mainDetail = detail;
        this.currentRenderList = null;
        this.renderTaskList(api, null, listArea, detail);
        void this.preloadCompletedData(api, null);
        void this.refreshSmartViewInBackground(api, lists, OVERDUE_VIEW_ID, null, listArea, detail);
    }

    async refreshSmartViewInBackground(
        api: MsTodoApi,
        lists: TodoList[],
        viewId: string,
        renderList: TodoList | null,
        listArea: HTMLElement,
        detail: HTMLElement,
    ) {
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
                this.setTaskCache(list.id, this.mergeServerTasksWithLocal(list.id, serverTasks), includeCompleted);
            }));
        } catch (error) {
            console.warn('后台刷新智能视图失败', error);
            return;
        }

        if (this.selectedListId !== viewId) return;
        this.currentTasks = viewId === OVERDUE_VIEW_ID
            ? this.collectOverdueTasks(lists)
            : this.collectMyDayTasks(lists);
        this.renderTaskList(api, renderList, listArea, detail);
    }

    async loadTaskList(api: MsTodoApi, main: HTMLElement, list: TodoList, token?: number) {
        const cached = this.taskCache.get(list.id);
        let tasks: TodoTask[];

        if (cached) {
            tasks = cached.tasks;
        } else {
            tasks = await api.getTasks(list.id, false);
            this.setTaskCache(list.id, tasks, false);
        }

        if (token !== undefined && token !== this.viewTransitionToken) return;

        this.taskListByTaskId.clear();
        tasks.forEach((task) => this.taskListByTaskId.set(task.id, list));
        this.currentTasks = tasks;
        main.empty();

        const listArea = main.createDiv({ cls: 'todo-task-list-area' });
        const detail = main.createDiv({ cls: 'todo-detail-panel' });
        this.mainListArea = listArea;
        this.mainDetail = detail;
        this.currentRenderList = list;
        const composer = main.createDiv({ cls: 'todo-add-composer' });
        const plus = composer.createSpan({ cls: 'todo-add-icon' });
        setIcon(plus, 'plus');
        const input = composer.createEl('input', {
            cls: 'todo-add-input',
            placeholder: '添加任务',
        });
        input.setAttr('aria-label', `添加任务到 ${list.displayName}`);

        const createTask = () => {
            const taskTitle = input.value.trim();
            if (!taskTitle) return;

            const optimisticTask = this.createOptimisticTask(taskTitle);
            this.pendingTaskIds.add(optimisticTask.id);
            this.taskListByTaskId.set(optimisticTask.id, list);
            this.currentTasks = [optimisticTask, ...this.currentTasks];
            this.upsertTaskInCache(list.id, optimisticTask);
            input.value = '';
            this.renderTaskList(api, list, listArea, detail);
            input.focus();

            void (async () => {
                try {
                    const task = await api.createTask(list.id, taskTitle);
                    this.replaceTemporaryTask(optimisticTask.id, task, list);
                    this.renderTaskList(api, list, listArea, detail);
                } catch (error) {
                    this.removeOptimisticTask(optimisticTask.id, list.id);
                    if (!input.value) input.value = taskTitle;
                    this.renderTaskList(api, list, listArea, detail);
                    new Notice('添加任务失败，已恢复输入内容');
                    console.error(error);
                }
            })();
        };

        input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                createTask();
            }
        });

        plus.onclick = () => input.focus();
        composer.onclick = (event) => {
            if (event.target === composer) input.focus();
        };

        this.renderTaskList(api, list, listArea, detail);
        void this.preloadCompletedData(api, list);
        if (cached) void this.refreshCachedList(api, list, listArea, detail);
    }

    async toggleTaskCompletionOptimistically(
        api: MsTodoApi,
        list: TodoList,
        listArea: HTMLElement,
        detail: HTMLElement,
        task: TodoTask,
    ) {
        if (this.pendingTaskIds.has(task.id)) return;

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
        if (completing && !this.showCompleted && this.selectedTaskId === task.id) {
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
            this.pendingTaskIds.delete(task.id);
            this.selectedTaskId = originalSelectedTaskId;
            this.replaceTask(originalTask, list.id);
            this.renderTaskList(api, list, listArea, detail);
            new Notice('更新任务失败，已恢复原状态');
            console.error(error);
        }
    }

    async loadCompletedForCurrentView(
        api: MsTodoApi,
        list: TodoList | null,
        listArea: HTMLElement,
        detail: HTMLElement,
    ) {
        try {
            if (isSmartViewId(this.selectedListId)) {
                await Promise.all(this.currentLists.map((item) => this.ensureAllTasksLoaded(api, item.id)));
                if (!isSmartViewId(this.selectedListId) || !this.showCompleted) return;
                this.currentTasks = this.selectedListId === OVERDUE_VIEW_ID
                    ? this.collectOverdueTasks(this.currentLists)
                    : this.collectMyDayTasks(this.currentLists);
                this.renderTaskList(api, list, listArea, detail);
                return;
            }

            if (!list) return;
            const selectedId = this.selectedListId;
            const tasks = await this.ensureAllTasksLoaded(api, list.id);
            if (this.selectedListId !== selectedId || !this.showCompleted) return;
            this.currentTasks = tasks;
            tasks.forEach((task) => this.taskListByTaskId.set(task.id, list));
            this.renderTaskList(api, list, listArea, detail);
        } catch (error) {
            if (this.showCompleted) {
                new Notice('加载已完成任务失败');
                this.renderTaskList(api, list, listArea, detail);
            }
            console.error(error);
        }
    }

    renderTaskList(api: MsTodoApi, list: TodoList | null, listArea: HTMLElement, detail: HTMLElement) {
        listArea.empty();
        detail.empty();
        detail.removeClass('is-open');

        const activeTasks = this.currentTasks.filter((task) => task.status !== 'completed');
        const completedTasks = this.currentTasks.filter((task) => task.status === 'completed');

        if (activeTasks.length === 0) {
            let emptyTitle: string;
            let emptySubtitle: string;
            if (this.isSearchMode()) {
                emptyTitle = '没有找到匹配的任务';
                emptySubtitle = '换个关键词试试。';
            } else if (this.selectedListId === MY_DAY_VIEW_ID) {
                emptyTitle = '今天没有到期任务';
                emptySubtitle = '你也可以从下方添加一个今天要完成的任务。';
            } else if (this.selectedListId === OVERDUE_VIEW_ID) {
                emptyTitle = '没有逾期任务';
                emptySubtitle = '所有任务都在正轨上，继续保持。';
            } else {
                emptyTitle = '这里暂时没有任务';
                emptySubtitle = '从下方添加一项新的待办。';
            }
            const empty = listArea.createDiv({ cls: 'todo-empty' });
            const emptyIcon = empty.createSpan({ cls: 'todo-empty-icon' });
            setIcon(emptyIcon, 'circle-check-big');
            empty.createEl('div', { text: emptyTitle, cls: 'todo-empty-title' });
            empty.createEl('div', { text: emptySubtitle, cls: 'todo-empty-subtitle' });
        } else {
            activeTasks.forEach((task) => {
                const sourceList = this.taskListByTaskId.get(task.id) || list;
                if (sourceList) this.renderTaskRow(api, listArea, detail, sourceList, task);
            });
        }

        const completedReady = this.isSearchMode() || this.isCompletedDataReady(list);
        const completedHeader = listArea.createEl('button', { cls: 'todo-completed-heading' });
        completedHeader.setAttr('type', 'button');
        const completedChevron = completedHeader.createSpan({ cls: 'todo-completed-chevron' });
        setIcon(completedChevron, this.showCompleted ? 'chevron-down' : 'chevron-right');
        completedHeader.createSpan({ text: '已完成', cls: 'todo-completed-title' });
        if (this.showCompleted && completedReady) {
            completedHeader.createSpan({ text: String(completedTasks.length), cls: 'todo-completed-count' });
        }

        completedHeader.onclick = () => {
            this.showCompleted = !this.showCompleted;
            this.selectedTaskId = null;
            this.renderTaskList(api, list, listArea, detail);
            if (this.showCompleted && !this.isSearchMode() && !this.isCompletedDataReady(list)) {
                void this.loadCompletedForCurrentView(api, list, listArea, detail);
            }
        };

        if (this.showCompleted) {
            completedTasks.forEach((task) => {
                const sourceList = this.taskListByTaskId.get(task.id) || list;
                if (sourceList) this.renderTaskRow(api, listArea, detail, sourceList, task);
            });

            if (!completedReady) {
                const loading = listArea.createDiv({ cls: 'todo-completed-loading' });
                const spinner = loading.createSpan({ cls: 'todo-inline-spinner' });
                setIcon(spinner, 'loader-circle');
                loading.createSpan({ text: '正在后台加载已完成任务…' });
            } else if (completedTasks.length === 0) {
                listArea.createEl('div', { text: '暂无已完成任务', cls: 'todo-completed-empty' });
            }
        }

        if (this.selectedTaskId) {
            const selectedTask = this.currentTasks.find((task) => task.id === this.selectedTaskId);
            if (selectedTask) {
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
        checkbox.setAttr('aria-label', task.status === 'completed' ? '重新打开任务' : '完成任务');
        checkbox.onclick = (event) => {
            event.stopPropagation();
            void this.toggleTaskCompletionOptimistically(api, list, listArea, detail, task);
        };

        const content = row.createSpan({ cls: 'todo-task-content' });
        content.createSpan({ text: task.title, cls: 'todo-task-title' });

        if (meta) {
            const metaLine = content.createSpan({ cls: `todo-task-meta is-${meta.kind}` });
            const metaIcon = metaLine.createSpan({ cls: 'todo-task-meta-icon' });
            if (isSmartViewId(this.selectedListId) || this.isSearchMode()) {
                setIcon(metaIcon, 'list');
                metaLine.createSpan({ text: `${list.displayName} · ${meta.text}` });
            } else {
                setIcon(metaIcon, meta.kind === 'completed' ? 'check' : 'calendar-days');
                metaLine.createSpan({ text: meta.text });
            }
        }

        const body = stripHtml(task.body?.content || '').trim();
        if (body) content.createSpan({ text: body, cls: 'todo-task-preview' });

        if (task.checklistItems && task.checklistItems.length > 0) {
            const checkedCount = task.checklistItems.filter((item) => item.isChecked).length;
            const steps = content.createSpan({ cls: 'todo-task-step-count' });
            const stepsIcon = steps.createSpan({ cls: 'todo-task-step-icon' });
            setIcon(stepsIcon, 'list-checks');
            steps.createSpan({ text: `${checkedCount}/${task.checklistItems.length}` });
        }

        const trailing = row.createSpan({ cls: 'todo-task-trailing' });
        if (this.pendingTaskIds.has(task.id)) {
            const syncing = trailing.createSpan({ cls: 'todo-task-sync-spinner', attr: { 'aria-label': '正在同步' } });
            setIcon(syncing, 'loader-circle');
        }
        if (task.importance === 'high') {
            const star = trailing.createSpan({ cls: 'todo-star is-important' });
            setIcon(star, 'star');
        }
        if (meta?.kind === 'overdue') {
            const alert = trailing.createSpan({ cls: 'todo-overdue-indicator' });
            setIcon(alert, 'circle-alert');
        }

        row.onclick = () => {
            if (this.pendingTaskIds.has(task.id)) return;
            this.selectTask(api, list, listArea, detail, task);
        };
    }

    selectTask(api: MsTodoApi, list: TodoList, listArea: HTMLElement, detail: HTMLElement, task: TodoTask) {
        this.selectedTaskId = task.id;
        listArea.querySelectorAll('.todo-task-row').forEach((row) => {
            row.toggleClass('is-selected', row.getAttr('data-task-id') === task.id);
        });
        this.renderTaskDetail(api, detail, listArea, list, task);
    }

    renderTaskDetail(api: MsTodoApi, detail: HTMLElement, listArea: HTMLElement, list: TodoList, task: TodoTask) {
        detail.empty();
        detail.addClass('is-open');

        const topbar = detail.createDiv({ cls: 'todo-detail-topbar' });
        const closeBtn = topbar.createEl('button', { cls: 'todo-icon-button todo-detail-close' });
        closeBtn.setAttr('type', 'button');
        closeBtn.setAttr('aria-label', '返回任务列表');
        setIcon(closeBtn, 'arrow-left');
        topbar.createSpan({ text: '任务详情', cls: 'todo-detail-topbar-title' });
        const topbarSpacer = topbar.createSpan({ cls: 'todo-detail-topbar-spacer' });
        topbarSpacer.setAttr('aria-hidden', 'true');

        closeBtn.onclick = () => {
            this.selectedTaskId = null;
            detail.empty();
            detail.removeClass('is-open');
            listArea.querySelectorAll('.todo-task-row').forEach((row) => row.removeClass('is-selected'));
        };

        const header = detail.createDiv({ cls: 'todo-detail-header' });
        const complete = header.createEl('input', { type: 'checkbox', cls: 'todo-task-checkbox' });
        complete.checked = task.status === 'completed';
        complete.onchange = () => {
            void this.toggleTaskCompletionOptimistically(api, list, listArea, detail, task);
        };

        const titleInput = header.createEl('textarea', { cls: 'todo-title-input' });
        titleInput.value = task.title;
        titleInput.rows = 2;
        titleInput.onblur = () => {
            const nextTitle = titleInput.value.trim();
            if (!nextTitle || nextTitle === task.title) return;
            void this.saveTaskChange(
                api,
                list,
                listArea,
                detail,
                task,
                () => api.updateTask(list.id, task.id, { title: nextTitle }),
                '标题已更新',
            );
        };

        const starBtn = header.createEl('button', { cls: 'todo-star-button' });
        starBtn.setAttr('type', 'button');
        starBtn.setAttr('aria-label', task.importance === 'high' ? '取消重要' : '标记为重要');
        setIcon(starBtn, 'star');
        if (task.importance === 'high') starBtn.addClass('is-important');
        starBtn.onclick = () => {
            void this.saveTaskChange(
                api,
                list,
                listArea,
                detail,
                task,
                () => api.toggleImportant(list.id, task),
                task.importance === 'high' ? '已取消重要' : '已标记为重要',
            );
        };

        const stepsCard = detail.createDiv({ cls: 'todo-detail-card' });
        const stepsLabel = stepsCard.createDiv({ cls: 'todo-detail-card-label' });
        const stepsLabelIcon = stepsLabel.createSpan();
        setIcon(stepsLabelIcon, 'list-checks');
        stepsLabel.createSpan({ text: '步骤' });
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
            op: () => Promise<unknown>,
            applyLocal: () => void,
            rollback: () => void,
            failMessage: string,
            afterSuccess?: () => void,
        ) => {
            applyLocal();
            this.renderTaskList(api, list, listArea, detail);
            void (async () => {
                try {
                    await op();
                    this.markTaskRecentlyMutated(task.id);
                    this.scheduleCachePersist();
                    if (afterSuccess) {
                        afterSuccess();
                        this.renderTaskList(api, list, listArea, detail);
                        refocusStepInput();
                    }
                } catch (error) {
                    rollback();
                    this.renderTaskList(api, list, listArea, detail);
                    new Notice(failMessage);
                    console.error(error);
                }
            })();
        };

        checklistItems.forEach((step) => {
            const stepRow = stepsCard.createDiv({ cls: 'todo-step-row' });
            const checked = stepRow.createEl('input', { type: 'checkbox' });
            checked.checked = step.isChecked;
            checked.setAttr('aria-label', step.isChecked ? `重新打开步骤：${step.displayName}` : `完成步骤：${step.displayName}`);
            const stepLabel = stepRow.createSpan({ text: step.displayName, cls: 'todo-step-label' });
            if (step.isChecked) stepLabel.addClass('is-checked');
            const removeBtn = stepRow.createEl('button', { cls: 'todo-step-remove' });
            removeBtn.setAttr('type', 'button');
            removeBtn.setAttr('aria-label', `删除步骤：${step.displayName}`);
            const removeIcon = removeBtn.createSpan();
            setIcon(removeIcon, 'x');

            checked.onchange = () => {
                const nextChecked = checked.checked;
                const previousItems = task.checklistItems ? [...task.checklistItems] : [];
                runChecklistMutation(
                    () => api.updateChecklistItem(list.id, task.id, step.id, { isChecked: nextChecked }),
                    () => {
                        task.checklistItems = previousItems.map((item) =>
                            item.id === step.id ? { ...item, isChecked: nextChecked } : item);
                    },
                    () => { task.checklistItems = previousItems; },
                    '更新步骤失败',
                );
            };

            removeBtn.onclick = () => {
                const previousItems = task.checklistItems ? [...task.checklistItems] : [];
                runChecklistMutation(
                    () => api.deleteChecklistItem(list.id, task.id, step.id),
                    () => {
                        task.checklistItems = previousItems.filter((item) => item.id !== step.id);
                    },
                    () => { task.checklistItems = previousItems; },
                    '删除步骤失败',
                );
            };
        });

        const stepComposer = stepsCard.createDiv({ cls: 'todo-step-add' });
        const stepAddIcon = stepComposer.createSpan({ cls: 'todo-step-add-icon' });
        setIcon(stepAddIcon, 'plus');
        const stepInput = stepComposer.createEl('input', { cls: 'todo-step-add-input' });
        stepInput.setAttr('type', 'text');
        stepInput.setAttr('placeholder', '添加步骤');
        stepInput.setAttr('maxlength', '255');
        stepInput.setAttr('aria-label', '添加步骤');

        const addStep = () => {
            const name = stepInput.value.trim();
            if (!name) {
                stepInput.focus();
                return;
            }
            const tempId = `local-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const previousItems = task.checklistItems ? [...task.checklistItems] : [];
            let createdItem: ChecklistItem | null = null;
            runChecklistMutation(
                async () => {
                    createdItem = await api.createChecklistItem(list.id, task.id, name);
                },
                () => {
                    task.checklistItems = [...previousItems, { id: tempId, displayName: name, isChecked: false }];
                },
                () => { task.checklistItems = previousItems; },
                '添加步骤失败',
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
            if (event.key === 'Enter') {
                event.preventDefault();
                addStep();
            }
        });

        const dateCard = detail.createDiv({ cls: 'todo-detail-card' });
        const dateLabel = dateCard.createDiv({ cls: 'todo-detail-card-label' });
        const dateLabelIcon = dateLabel.createSpan();
        setIcon(dateLabelIcon, 'calendar-days');
        dateLabel.createSpan({ text: '截止日期' });
        const dateInput = dateCard.createEl('input', { type: 'date' });
        dateInput.value = dateToInputValue(task.dueDateTime?.dateTime || '');
        dateInput.onchange = () => {
            void this.saveTaskChange(
                api,
                list,
                listArea,
                detail,
                task,
                () => api.updateTaskDueDate(list.id, task.id, dateInput.value),
                dateInput.value ? '截止日期已更新' : '截止日期已清除',
            );
        };
        if (task.dueDateTime?.dateTime) {
            const clearDate = dateCard.createEl('button', { text: '清除日期', cls: 'todo-link-button' });
            clearDate.onclick = () => {
                void this.saveTaskChange(
                    api,
                    list,
                    listArea,
                    detail,
                    task,
                    () => api.updateTaskDueDate(list.id, task.id, ''),
                    '截止日期已清除',
                );
            };
        }

        const chipsRow = dateCard.createDiv({ cls: 'todo-date-chips' });
        const currentDue = dateToInputValue(task.dueDateTime?.dateTime || '');
        const dateChips: Array<{ label: string; days: number }> = [
            { label: '今天', days: 0 },
            { label: '明天', days: 1 },
            { label: '下周', days: 7 },
        ];
        dateChips.forEach((chip) => {
            const chipDate = new Date();
            chipDate.setDate(chipDate.getDate() + chip.days);
            const chipKey = toLocalDateKey(chipDate);
            const chipBtn = chipsRow.createEl('button', { text: chip.label, cls: 'todo-date-chip' });
            chipBtn.setAttr('type', 'button');
            chipBtn.setAttr('aria-label', `截止日期设为${chip.label}`);
            if (currentDue === chipKey) chipBtn.addClass('is-active');
            chipBtn.onclick = () => {
                void this.saveTaskChange(
                    api,
                    list,
                    listArea,
                    detail,
                    task,
                    () => api.updateTaskDueDate(list.id, task.id, chipKey),
                    `截止日期已设为${chip.label}`,
                );
            };
        });

        const noteCard = detail.createDiv({ cls: 'todo-detail-card' });
        const noteLabel = noteCard.createDiv({ cls: 'todo-detail-card-label' });
        const noteLabelIcon = noteLabel.createSpan();
        setIcon(noteLabelIcon, 'notebook-pen');
        noteLabel.createSpan({ text: '备注' });
        const noteInput = noteCard.createEl('textarea', { cls: 'todo-note-input', placeholder: '添加备注' });
        noteInput.value = stripHtml(task.body?.content || '');
        noteInput.rows = 8;
        const saveNote = noteCard.createEl('button', { text: '保存备注', cls: 'todo-primary-button todo-save-note' });
        saveNote.onclick = () => {
            void this.saveTaskChange(
                api,
                list,
                listArea,
                detail,
                task,
                () => api.updateTaskBody(list.id, task.id, noteInput.value),
                '备注已更新',
            );
        };

        const footer = detail.createDiv({ cls: 'todo-detail-footer' });
        const footerMeta = footer.createDiv({ cls: 'todo-detail-footer-meta' });
        if (task.createdDateTime) footerMeta.createSpan({ text: `创建于 ${formatDisplayDate(task.createdDateTime)}` });
        if (task.completedDateTime?.dateTime) footerMeta.createSpan({ text: `完成于 ${formatDisplayDate(task.completedDateTime.dateTime)}` });

        const deleteButton = footer.createEl('button', { cls: 'todo-delete-task-button' });
        deleteButton.setAttr('type', 'button');
        deleteButton.setAttr('aria-label', `删除任务：${task.title}`);
        const deleteIcon = deleteButton.createSpan({ cls: 'todo-delete-task-icon' });
        setIcon(deleteIcon, 'trash-2');
        deleteButton.createSpan({ text: '删除任务' });
        deleteButton.onclick = () => {
            void this.confirmAndDeleteTask(api, list, listArea, detail, task);
        };
    }

    async confirmAndDeleteTask(
        api: MsTodoApi,
        list: TodoList,
        listArea: HTMLElement,
        detail: HTMLElement,
        task: TodoTask,
    ) {
        if (this.pendingTaskIds.has(task.id)) return;

        const confirmed = await new Promise<boolean>((resolve) => {
            new DeleteConfirmModal(this.app, {
                title: '删除任务？',
                before: '确定要删除“',
                bold: task.title,
                after: '”吗？删除后无法恢复。',
            }, resolve).open();
        });
        if (!confirmed) return;

        const previousCurrentTasks = [...this.currentTasks];
        const previousSelectedTaskId = this.selectedTaskId;
        const cacheEntry = this.taskCache.get(list.id);
        const previousCacheTasks = cacheEntry ? [...cacheEntry.tasks] : null;

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
            this.pendingTaskIds.delete(task.id);
            this.removeTaskFromCache(list.id, task.id);
            this.taskListByTaskId.delete(task.id);
            new Notice('任务已删除');
        } catch (error) {
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
            new Notice('删除任务失败，已恢复');
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
        try {
            const updatedTask = await update();
            this.markTaskRecentlyMutated(updatedTask.id || task.id);
            this.replaceTask(updatedTask, list.id);
            this.selectedTaskId = updatedTask.id || task.id;
            new Notice(successMessage);
            this.renderTaskList(api, list, listArea, detail);
        } catch (error) {
            new Notice('更新任务失败');
            console.error(error);
        }
    }

    replaceTask(updatedTask: TodoTask, listId?: string) {
        if (listId) this.upsertTaskInCache(listId, updatedTask);

        if (isSmartViewId(this.selectedListId) && !this.isSearchMode()) {
            const today = toLocalDateKey(new Date());
            const belongsToView = this.selectedListId === MY_DAY_VIEW_ID
                ? isTaskDueOn(updatedTask, today)
                : isTaskOverdue(updatedTask, today);
            if (!belongsToView) {
                this.currentTasks = this.currentTasks.filter((task) => task.id !== updatedTask.id);
                this.taskListByTaskId.delete(updatedTask.id);
                if (this.selectedTaskId === updatedTask.id) this.selectedTaskId = null;
                return;
            }
        }
        this.currentTasks = this.currentTasks.map((task) => task.id === updatedTask.id ? updatedTask : task);
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}


interface DeleteConfirmOptions {
    title: string;
    before: string;
    bold: string;
    after: string;
    confirmText?: string;
}

class DeleteConfirmModal extends Modal {
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

        const message = this.contentEl.createEl('p');
        message.createSpan({ text: this.options.before });
        message.createEl('strong', { text: this.options.bold });
        message.createSpan({ text: this.options.after });

        const actions = this.contentEl.createDiv({ cls: 'todo-delete-confirm-actions' });
        const cancel = actions.createEl('button', { text: '取消' });
        cancel.setAttr('type', 'button');
        cancel.onclick = () => this.finish(false);

        const confirm = actions.createEl('button', {
            text: this.options.confirmText ?? '删除',
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

class CreateListModal extends Modal {
    private resolve: (name: string | null) => void;
    private settled = false;
    private input!: HTMLInputElement;

    constructor(app: App, resolve: (name: string | null) => void) {
        super(app);
        this.resolve = resolve;
    }

    onOpen() {
        this.titleEl.setText('新建清单');
        this.contentEl.addClass('todo-create-list-modal');

        this.input = this.contentEl.createEl('input', {
            cls: 'todo-create-list-input',
            attr: { type: 'text', placeholder: '输入清单名称', maxlength: '64' },
        });
        this.input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.submit();
            }
        });
        window.setTimeout(() => this.input.focus(), 0);

        const actions = this.contentEl.createDiv({ cls: 'todo-delete-confirm-actions' });
        const cancel = actions.createEl('button', { text: '取消' });
        cancel.setAttr('type', 'button');
        cancel.onclick = () => this.finish(null);

        const confirm = actions.createEl('button', { text: '创建', cls: 'mod-cta' });
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

function buildTaskMeta(task: TodoTask): TaskMeta | null {
    if (task.status === 'completed') {
        const completedDate = task.completedDateTime?.dateTime;
        return {
            text: completedDate ? formatFriendlyDate(completedDate) : '已完成',
            kind: 'completed',
        };
    }

    const due = dateToInputValue(task.dueDateTime?.dateTime || '');
    if (!due) return null;

    const today = toLocalDateKey(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = toLocalDateKey(tomorrowDate);

    if (due === today) return { text: '今天', kind: 'today' };
    if (due === tomorrow) return { text: '明天', kind: 'tomorrow' };
    if (due < today) return { text: `逾期 · ${formatShortDate(due)}`, kind: 'overdue' };
    return { text: formatShortDate(due), kind: 'date' };
}

function isTaskDueOn(task: TodoTask, dateKey: string): boolean {
    return dateToInputValue(task.dueDateTime?.dateTime || '') === dateKey;
}

function isTaskOverdue(task: TodoTask, today: string): boolean {
    const due = dateToInputValue(task.dueDateTime?.dateTime || '');
    return !!due && due < today;
}

function toLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export { toLocalDateKey };

function dateToInputValue(value: string): string {
    if (!value) return '';
    return value.includes('T') ? (value.split('T')[0] || '') : value;
}

function formatShortDate(value: string): string {
    const date = dateToInputValue(value);
    const parts = date.split('-');
    if (parts.length !== 3) return date;
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    return `${month}月${day}日`;
}

function formatFriendlyDate(value: string): string {
    const date = dateToInputValue(value);
    if (!date) return value;

    const today = toLocalDateKey(new Date());
    if (date === today) return '今天';
    return formatShortDate(date);
}

function formatDisplayDate(value: string): string {
    const date = dateToInputValue(value);
    if (!date) return value;
    const parts = date.split('-');
    if (parts.length !== 3) return date;
    return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function stripHtml(value: string): string {
    return value
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/p>\s*<p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
