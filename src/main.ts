import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, requestUrl, Notice, ObsidianProtocolData } from 'obsidian';
import { AuthManager, CLIENT_ID, TokenResponse } from './auth';

const VIEW_TYPE_TODO = "ms-todo-view";
const GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0';

interface MsTodoSettings {
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: number; 
}

const DEFAULT_SETTINGS: MsTodoSettings = {
    accessToken: '',
    refreshToken: '',
    tokenExpiresAt: 0
}

class MsTodoApi {
    plugin: MsTodoPlugin;
    auth: AuthManager;

    constructor(plugin: MsTodoPlugin) {
        this.plugin = plugin;
        this.auth = new AuthManager();
    }

    async getValidToken(): Promise<string> {
        const now = Date.now();
        if (this.plugin.settings.tokenExpiresAt - now < 5 * 60 * 1000) {
            if (this.plugin.settings.refreshToken) {
                try {
                    console.log("Token即将过期，正在刷新...");
                    const newTokens = await this.auth.refreshAccessToken(this.plugin.settings.refreshToken);
                    await this.plugin.saveTokens(newTokens);
                    return newTokens.access_token;
                } catch (e) {
                    new Notice("登录已过期，请重新登录");
                    throw e;
                }
            } else {
                throw new Error("没有登录信息");
            }
        }
        return this.plugin.settings.accessToken;
    }

    async request(url: string, method: string = 'GET', body?: any) {
        const token = await this.getValidToken();
        return requestUrl({
            url: url,
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });
    }

    async getTaskLists() {
        const res = await this.request(`${GRAPH_ENDPOINT}/me/todo/lists`);
        return res.json.value;
    }

    async getTasks(listId: string) {
        const res = await this.request(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'`);
        return res.json.value;
    }
    
    async createTask(listId: string, title: string) {
        await this.request(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks`, 'POST', { title });
    }

    async completeTask(listId: string, taskId: string) {
        await this.request(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks/${taskId}`, 'PATCH', { status: 'completed' });
    }
}

class TodoView extends ItemView {
    plugin: MsTodoPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: MsTodoPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_TODO; }
    getDisplayText() { return "Microsoft To Do"; }
    getIcon() { return "check-square"; }

    async onOpen() {
        this.render();
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass("ms-todo-container");
        container.createEl("h4", { text: "My Tasks" });

        // 如果没有 Token，显示登录按钮
        if (!this.plugin.settings.accessToken) {
            const loginBtn = container.createEl("button", { text: "Sign in Microsoft To Do" });
            loginBtn.onclick = () => this.plugin.login();
            return;
        }

        const loading = container.createEl("div", { text: "Loading..." });

        try {
            const api = new MsTodoApi(this.plugin);
            const lists = await api.getTaskLists();
            
            if (!lists || lists.length === 0) {
                loading.setText("No tasks found");
                return;
            }
            const defaultListId = lists[0].id;
            loading.remove();

            // 任务列表容器
            const taskContainer = container.createEl("div");
            
            // 刷新按钮
            const controls = container.createEl("div", {attr: {style: "display: flex; gap: 10px; margin-bottom: 10px;"}});
            const refreshBtn = controls.createEl("button", { text: "Refresh" });
            const logoutBtn = controls.createEl("button", { text: "Sign out" });
            
            refreshBtn.onclick = () => this.render();
            logoutBtn.onclick = async () => {
                await this.plugin.clearData();
                this.render();
            };

            const tasks = await api.getTasks(defaultListId);
            
            if (tasks.length === 0) taskContainer.createEl("div", { text: "Nothing to do 🎉" });

            tasks.forEach((task: any) => {
                const row = taskContainer.createEl("div", { cls: "todo-item" });
                const checkbox = row.createEl("input", { type: "checkbox" });
                checkbox.onclick = async () => {
                    row.addClass("completed");
                    await api.completeTask(defaultListId, task.id);
                    setTimeout(() => this.render(), 500);
                };
                row.createSpan({ text: task.title });
            });

            // 添加输入框
            const input = container.createEl("input", { placeholder: "Add a task...", attr: { style: "width: 100%; margin-top: 10px;" } });
            input.addEventListener("keypress", async (e) => {
                if (e.key === "Enter" && input.value.trim()) {
                    await api.createTask(defaultListId, input.value);
                    new Notice("Added");
                    this.render();
                }
            });

        } catch (e) {
            loading.setText("Error");
            container.createEl("div", { text: String(e), attr: { style: "color: red" } });
            console.error(e);
        }
    }
}

export default class MsTodoPlugin extends Plugin {
    settings: MsTodoSettings;
    auth: AuthManager;
    pkceVerifier: string = ''; 

    async onload() {
        await this.loadSettings();
        this.auth = new AuthManager();

        this.registerObsidianProtocolHandler('mstodo-auth', async (data: ObsidianProtocolData) => {
            await this.handleAuthCallback(data);
        });

        this.registerView(VIEW_TYPE_TODO, (leaf) => new TodoView(leaf, this));
        this.addRibbonIcon('check-square', 'Microsoft To Do', () => this.activateView());

        this.addSettingTab(new MsTodoSettingTab(this.app, this));
    }

    // --- 登录流程 ---
    async login() {
        if (!CLIENT_ID.includes("Here")) {
            this.pkceVerifier = this.auth.generateCodeVerifier();
            const url = await this.auth.getAuthUrl(this.pkceVerifier);
            window.open(url);
        }
    }

    // --- 回调处理 ---
    async handleAuthCallback(data: ObsidianProtocolData) {
        if (data.error) {
            new Notice("Refused");
            return;
        }

        if (data.code) {
            try {
                new Notice("Connecting to Microsoft...");
                // 用 Code 换 Token
                const tokens = await this.auth.exchangeCodeForToken(data.code, this.pkceVerifier);
                await this.saveTokens(tokens);
                new Notice("Success！");
                
                // 刷新视图
                this.refreshView();
            } catch (e) {
                console.error(e);
                new Notice("获取 Token 失败，请看控制台");
            }
        }
    }

    async saveTokens(tokens: TokenResponse) {
        this.settings.accessToken = tokens.access_token;
        this.settings.refreshToken = tokens.refresh_token || this.settings.refreshToken; // 如果新响应没带refresh，保留旧的
        this.settings.tokenExpiresAt = Date.now() + (tokens.expires_in * 1000);
        await this.saveSettings();
    }

    async clearData() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        await this.saveSettings();
    }

    refreshView() {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO);
        leaves.forEach(leaf => { if (leaf.view instanceof TodoView) leaf.view.render(); });
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_TODO);
        if (leaves.length > 0) leaf = leaves[0] as WorkspaceLeaf;
        else {
            leaf = workspace.getRightLeaf(false);
            if(leaf) await leaf.setViewState({ type: VIEW_TYPE_TODO, active: true });
        }
        if(leaf) workspace.revealLeaf(leaf);
    }
}

class MsTodoSettingTab extends PluginSettingTab {
    plugin: MsTodoPlugin;
    constructor(app: App, plugin: MsTodoPlugin) { super(app, plugin); this.plugin = plugin; }
    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Microsoft To Do' });
        
        if(this.plugin.settings.accessToken) {
             containerEl.createEl('p', { text: '✅ Signed in', attr: {style: 'color: green'} });
             new Setting(containerEl).addButton(btn => btn.setButtonText("Sign out").onClick(() => {
                 this.plugin.clearData();
                 this.display();
             }));
        } else {
             containerEl.createEl('p', { text: '❌ Not signed in' });
             new Setting(containerEl).addButton(btn => btn.setButtonText("Sign in").onClick(() => this.plugin.login()));
        }
    }
}