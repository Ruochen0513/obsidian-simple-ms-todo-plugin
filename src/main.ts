import { AbstractInputSuggest, App, Notice, ObsidianProtocolData, Plugin, PluginSettingTab, Setting, TFolder, WorkspaceLeaf } from 'obsidian';
import { AuthManager, CLIENT_ID, TokenResponse } from './auth';
import { MsTodoApi, TodoList } from './api/ms-todo-api';
import { TodoView, VIEW_TYPE_TODO, TaskCacheSnapshot } from './ui/todo-view';
import { QuickCaptureModal } from './ui/quick-capture-modal';
import { DEFAULT_SETTINGS, MsTodoSettings } from './settings';

export default class MsTodoPlugin extends Plugin {
    settings: MsTodoSettings;
    auth: AuthManager;
    pkceVerifier: string = '';
    taskCacheSnapshot: TaskCacheSnapshot | null = null;

    async onload() {
        await this.loadSettings();
        this.auth = new AuthManager();

        this.registerObsidianProtocolHandler('mstodo-auth', async (data: ObsidianProtocolData) => {
            await this.handleAuthCallback(data);
        });

        this.registerView(VIEW_TYPE_TODO, (leaf) => new TodoView(leaf, this));
        this.addRibbonIcon('check-square', 'Microsoft To Do', () => this.activateView());

        this.addCommand({
            id: 'open-view',
            name: '打开 Microsoft To Do 侧边栏',
            callback: () => { void this.activateView(); },
        });

        this.addCommand({
            id: 'quick-capture',
            name: '快速捕获：添加任务',
            callback: () => { void this.openQuickCapture(); },
        });

        this.addCommand({
            id: 'sync-to-markdown',
            name: '同步 Microsoft To Do 到 Markdown',
            callback: () => this.syncTasksToMarkdown(),
        });

        this.addSettingTab(new MsTodoSettingTab(this.app, this));

        if (this.settings.syncOnStartup && this.settings.markdownSyncEnabled && this.settings.accessToken) {
            window.setTimeout(() => {
                void this.syncTasksToMarkdown({ silent: true });
            }, 2000);
        }
    }

    async login() {
        if (!CLIENT_ID.includes('Here')) {
            this.pkceVerifier = this.auth.generateCodeVerifier();
            const url = await this.auth.getAuthUrl(this.pkceVerifier);
            window.open(url);
        }
    }

    async handleAuthCallback(data: ObsidianProtocolData) {
        if (data.error) {
            new Notice('授权已取消');
            return;
        }

        if (data.code) {
            try {
                new Notice('正在连接 Microsoft To Do…');
                const tokens = await this.auth.exchangeCodeForToken(data.code, this.pkceVerifier);
                await this.saveTokens(tokens);
                new Notice('Microsoft To Do 已连接');
                this.refreshView();
                if (this.settings.syncAfterLogin && this.settings.markdownSyncEnabled) {
                    await this.syncTasksToMarkdown({ silent: true });
                }
            } catch (error) {
                console.error(error);
                new Notice('获取登录令牌失败，请查看控制台。');
            }
        }
    }

    async saveTokens(tokens: TokenResponse) {
        this.settings.accessToken = tokens.access_token;
        this.settings.refreshToken = tokens.refresh_token || this.settings.refreshToken;
        this.settings.tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
        await this.saveSettings();
    }

    async clearData() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        this.taskCacheSnapshot = null;
        await this.saveSettings();
    }

    onunload() {
        this.getTodoView()?.flushTaskCachePersist();
    }

    refreshView() {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO);
        leaves.forEach(leaf => { if (leaf.view instanceof TodoView) void leaf.view.render(); });
    }

    getTodoView(): TodoView | null {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO);
        for (const leaf of leaves) {
            if (leaf.view instanceof TodoView) return leaf.view;
        }
        return null;
    }

    async openQuickCapture() {
        if (!this.settings.accessToken) {
            new Notice('请先登录 Microsoft To Do（打开侧边栏完成登录）');
            return;
        }

        const api = new MsTodoApi(this);
        let lists: TodoList[] = [];
        const view = this.getTodoView();
        if (view && view.currentLists.length > 0) {
            lists = view.currentLists;
        } else {
            try {
                lists = await api.getTaskLists();
            } catch (error) {
                new Notice('获取清单失败');
                console.error(error);
                return;
            }
        }

        const defaultList = lists.find((list) => list.wellknownListName === 'defaultList') || lists[0];
        const currentList = view ? view.getSelectedList(view.currentLists) : null;
        const preferredListId = currentList?.id || defaultList?.id;
        new QuickCaptureModal(this.app, this, api, lists, preferredListId).open();
    }

    async syncTasksToMarkdown(options: { silent?: boolean } = {}) {
        if (!this.settings.accessToken) {
            new Notice('请先登录 Microsoft To Do');
            return;
        }

        if (!this.settings.markdownSyncEnabled) {
            if (!options.silent) {
                new Notice('Markdown 同步已关闭，可在插件设置中开启');
            }
            return;
        }

        try {
            const api = new MsTodoApi(this);
            const result = await api.syncAllTasksToMarkdown();
            if (!options.silent) {
                new Notice(`已将 ${result.listCount} 个清单中的 ${result.taskCount} 个任务同步到 ${result.path}`);
            }
        } catch (error) {
            console.error(error);
            if (!options.silent) {
                new Notice('同步 Microsoft To Do 到 Markdown 失败');
            }
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        this.taskCacheSnapshot = null;

        const data = await this.loadData() as Record<string, unknown> | null;
        if (!data) return;

        const { taskCacheSnapshot, ...settingsData } = data;
        Object.assign(this.settings, settingsData);
        this.taskCacheSnapshot = isValidTaskCacheSnapshot(taskCacheSnapshot) ? taskCacheSnapshot : null;
    }

    async saveSettings() {
        const payload: Record<string, unknown> = { ...this.settings };
        if (this.taskCacheSnapshot) payload.taskCacheSnapshot = this.taskCacheSnapshot;
        await this.saveData(payload);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_TODO);
        if (leaves.length > 0) leaf = leaves[0] as WorkspaceLeaf;
        else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) await leaf.setViewState({ type: VIEW_TYPE_TODO, active: true });
        }
        if (leaf) void workspace.revealLeaf(leaf);
    }
}

function isValidTaskCacheSnapshot(value: unknown): value is TaskCacheSnapshot {
    if (!value || typeof value !== 'object') return false;
    const snapshot = value as Partial<TaskCacheSnapshot>;
    if (snapshot.version !== 1) return false;
    if (!Array.isArray(snapshot.lists) || snapshot.lists.length === 0) return false;
    if (!snapshot.lists.every((list) => !!list && typeof list.id === 'string' && typeof list.displayName === 'string')) return false;
    if (!snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries)) return false;
    return Object.values(snapshot.entries).every((entry) =>
        !!entry && Array.isArray(entry.tasks) && typeof entry.allLoaded === 'boolean' && typeof entry.updatedAt === 'number');
}

class FolderPathSuggest extends AbstractInputSuggest<string> {
    private onChoose: (folderPath: string) => void;

    constructor(app: App, inputEl: HTMLInputElement, onChoose: (folderPath: string) => void) {
        super(app, inputEl);
        this.onChoose = onChoose;
    }

    getSuggestions(query: string): string[] {
        const lower = query.trim().toLowerCase();
        const folders: string[] = [];
        this.app.vault.getAllLoadedFiles().forEach((file) => {
            if (file instanceof TFolder && file.path !== '/') folders.push(file.path);
        });
        const filtered = lower
            ? folders.filter((path) => path.toLowerCase().includes(lower))
            : folders;
        return filtered.slice(0, 20);
    }

    renderSuggestion(folderPath: string, el: HTMLElement) {
        el.setText(folderPath);
    }

    selectSuggestion(folderPath: string, evt: MouseEvent | KeyboardEvent) {
        super.selectSuggestion(folderPath, evt);
        this.onChoose(folderPath);
    }
}

class MsTodoSettingTab extends PluginSettingTab {
    plugin: MsTodoPlugin;

    constructor(app: App, plugin: MsTodoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Microsoft To Do')
            .setHeading();

        if (this.plugin.settings.accessToken) {
            new Setting(containerEl)
                .setName('账户状态')
                .setDesc('✅ 已登录')
                .addButton(btn => btn
                    .setButtonText('退出登录')
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.clearData();
                        this.display();
                    })
                );
        } else {
            new Setting(containerEl)
                .setName('账户状态')
                .setDesc('❌ 未登录')
                .addButton(btn => btn
                    .setButtonText('登录')
                    .setCta()
                    .onClick(() => {
                        void this.plugin.login();
                    })
                );
        }

        new Setting(containerEl)
            .setName('Markdown 同步')
            .setDesc('将全部清单单向生成一个 Markdown 文件。关闭后不再创建或更新该文件。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.markdownSyncEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.markdownSyncEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.markdownSyncEnabled) {
            let syncPathInput: HTMLInputElement | null = null;
            const applySyncPath = async (value: string) => {
                this.plugin.settings.markdownSyncPath = value.trim() || DEFAULT_SETTINGS.markdownSyncPath;
                await this.plugin.saveSettings();
            };
            new Setting(containerEl)
                .setName('Markdown 同步文件')
                .setDesc('文件路径。点击输入框会弹出文件夹建议，选择后自动带上当前文件名；目标文件夹会在同步时自动创建。')
                .addSearch(search => {
                    syncPathInput = search.inputEl;
                    search
                        .setPlaceholder('Microsoft To Do.md')
                        .setValue(this.plugin.settings.markdownSyncPath)
                        .onChange((value) => { void applySyncPath(value); });
                });
            if (syncPathInput) {
                new FolderPathSuggest(this.app, syncPathInput, (folderPath) => {
                    const current = this.plugin.settings.markdownSyncPath.trim();
                    const currentName = current.split('/').pop() || 'Microsoft To Do.md';
                    const folder = folderPath.replace(/^\/+|\/+$/g, '');
                    const next = folder ? `${folder}/${currentName}` : currentName;
                    if (syncPathInput) syncPathInput.value = next;
                    void applySyncPath(next);
                });
            }

            new Setting(containerEl)
                .setName('登录后同步')
                .setDesc('成功登录后自动创建或更新 Markdown 同步文件。')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.syncAfterLogin)
                    .onChange(async (value) => {
                        this.plugin.settings.syncAfterLogin = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('启动时同步')
                .setDesc('Obsidian 启动后自动刷新 Markdown 同步文件。')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.syncOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.syncOnStartup = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('手动同步 Markdown')
                .setDesc('立即获取全部 Microsoft To Do 清单并写入 Markdown 同步文件。')
                .addButton(btn => btn
                    .setButtonText('立即同步')
                    .setCta()
                    .onClick(() => {
                        void this.plugin.syncTasksToMarkdown();
                    }));
        }
    }
}
