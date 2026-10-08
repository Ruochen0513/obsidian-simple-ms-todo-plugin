import { Notice, Plugin, type ObsidianProtocolData, type WorkspaceLeaf } from 'obsidian';
import { AuthSession } from './auth/session';
import { registerCommands, syncTasksToMarkdown } from './commands';
import { readSettings, type MsTodoSettings } from './settings';
import { isValidTaskCacheSnapshot, type TaskCacheSnapshot } from './sync/task-cache';
import { MsTodoSettingTab } from './ui/settings-tab';
import { TodoView, VIEW_TYPE_TODO } from './ui/todo-view';
import { setLocale, t, type LocalePreference } from './i18n';

export default class MsTodoPlugin extends Plugin {
    settings: MsTodoSettings;
    session: AuthSession;
    taskCacheSnapshot: TaskCacheSnapshot | null = null;
    private settingsSave: Promise<void> = Promise.resolve();

    async onload() {
        this.session = new AuthSession(this.app.secretStorage);
        await this.loadSettings();
        this.registerObsidianProtocolHandler('mstodo-auth', data => this.handleAuthCallback(data));
        this.registerView(VIEW_TYPE_TODO, leaf => new TodoView(leaf, this));
        this.addRibbonIcon('check-square', 'Microsoft To Do', () => { void this.activateView(); });
        registerCommands(this);
        this.addSettingTab(new MsTodoSettingTab(this.app, this));

        if (this.settings.syncOnStartup && this.settings.markdownSyncEnabled && this.session.signedIn) {
            const timer = window.setTimeout(() => {
                void syncTasksToMarkdown(this, { silent: true });
            }, 2000);
            this.register(() => window.clearTimeout(timer));
        }
    }

    onunload() {
        this.getTodoView()?.flushTaskCachePersist();
        this.session?.invalidate();
    }

    async login() {
        try {
            await this.session.login();
        } catch {
            new Notice(t('notices.tokenFailed'));
        }
    }

    async handleAuthCallback(data: ObsidianProtocolData) {
        if (data.error) {
            new Notice(t('notices.authorizationRefused'));
            return;
        }
        if (!data.code) return;
        const version = this.session.version;
        try {
            const connected = await this.session.completeLogin(data.code);
            if (!connected) return;
            this.taskCacheSnapshot = null;
            new Notice(t('notices.connected'));
            this.refreshView();
            if (this.settings.syncAfterLogin && this.settings.markdownSyncEnabled) {
                await syncTasksToMarkdown(this, { silent: true });
            }
        } catch {
            if (version === this.session.version) new Notice(t('notices.tokenFailed'));
        }
    }

    async clearData() {
        try {
            this.session.signOut();
        } catch {
            new Notice(t('account.signOutFailed'));
            return;
        }
        this.taskCacheSnapshot = null;
        this.refreshView();
        await this.saveSettings();
    }

    async setPluginLocale(locale: LocalePreference) {
        if (this.settings.locale === locale) return;
        this.settings.locale = locale;
        await this.saveSettings();
        setLocale(locale);
        registerCommands(this);
        this.refreshView();
    }

    async loadSettings() {
        const loaded: unknown = await this.loadData();
        const data = loaded && typeof loaded === 'object' ? loaded as Record<string, unknown> : {};
        this.settings = readSettings(data);
        setLocale(this.settings.locale);
        this.taskCacheSnapshot = isValidTaskCacheSnapshot(data.taskCacheSnapshot) ? data.taskCacheSnapshot : null;
        try {
            this.session.restore(data.refreshToken);
        } catch {
            new Notice(t('account.storageFailed'));
            throw new Error(t('account.storageFailed'));
        }
        if (!this.session.signedIn) this.taskCacheSnapshot = null;
        if ('accessToken' in data || 'refreshToken' in data || 'tokenExpiresAt' in data) {
            await this.saveSettings();
        }
    }

    async saveSettings() {
        const payload: Record<string, unknown> = { ...readSettings(this.settings) };
        if (this.taskCacheSnapshot) payload.taskCacheSnapshot = this.taskCacheSnapshot;
        // Keep sign-out's cleared data after any save that was already in flight.
        this.settingsSave = this.settingsSave.catch(() => {}).then(() => this.saveData(payload));
        await this.settingsSave;
    }

    refreshView() {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)) {
            if (leaf.view instanceof TodoView) void leaf.view.render();
        }
    }

    getTodoView(): TodoView | null {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO)) {
            if (leaf.view instanceof TodoView) return leaf.view;
        }
        return null;
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TODO)[0] || null;
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            if (leaf) await leaf.setViewState({ type: VIEW_TYPE_TODO, active: true });
        }
        if (leaf) void workspace.revealLeaf(leaf);
    }
}
