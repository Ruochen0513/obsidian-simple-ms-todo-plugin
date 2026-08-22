import { Notice, normalizePath, requestUrl } from 'obsidian';
import { AuthManager } from '../auth';
import type MsTodoPlugin from '../main';
import { buildMarkdownDocument } from '../sync/markdown';

const GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0';

export interface TodoList {
    id: string;
    displayName: string;
    wellknownListName?: string;
}

export interface ChecklistItem {
    id: string;
    displayName: string;
    isChecked: boolean;
}

export interface LinkedResource {
    id: string;
    displayName?: string;
    webUrl?: string;
    applicationName?: string;
}

export interface TodoDateTime {
    dateTime: string;
    timeZone: string;
}

export interface TodoTask {
    id: string;
    title: string;
    status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred';
    body?: {
        content?: string;
        contentType?: string;
    };
    dueDateTime?: TodoDateTime;
    reminderDateTime?: TodoDateTime;
    importance?: 'low' | 'normal' | 'high';
    isReminderOn?: boolean;
    createdDateTime?: string;
    lastModifiedDateTime?: string;
    completedDateTime?: TodoDateTime;
    checklistItems?: ChecklistItem[];
    linkedResources?: LinkedResource[];
}

export interface UpdateTaskPayload {
    title?: string;
    status?: TodoTask['status'];
    body?: {
        content: string;
        contentType: 'text' | 'html';
    };
    dueDateTime?: TodoDateTime | null;
    importance?: TodoTask['importance'];
}

interface GraphCollection<T> {
    value: T[];
    '@odata.nextLink'?: string;
}

export class MsTodoApi {
    plugin: MsTodoPlugin;
    auth: AuthManager;
    private refreshPromise: Promise<string> | null = null;

    constructor(plugin: MsTodoPlugin) {
        this.plugin = plugin;
        this.auth = new AuthManager();
    }

    async getValidToken(): Promise<string> {
        const now = Date.now();
        if (this.plugin.settings.tokenExpiresAt - now < 5 * 60 * 1000) {
            if (this.plugin.settings.refreshToken) {
                if (!this.refreshPromise) {
                    this.refreshPromise = this.refreshTokenOnce()
                        .finally(() => { this.refreshPromise = null; });
                }
                return this.refreshPromise;
            }
            throw new Error('未找到登录信息');
        }
        return this.plugin.settings.accessToken;
    }

    private async refreshTokenOnce(): Promise<string> {
        try {
            console.warn('Microsoft To Do 登录令牌即将过期，正在刷新…');
            const newTokens = await this.auth.refreshAccessToken(this.plugin.settings.refreshToken);
            await this.plugin.saveTokens(newTokens);
            return newTokens.access_token;
        } catch (error) {
            new Notice('登录已过期，请重新登录 Microsoft To Do。');
            throw error;
        }
    }

    async request<T>(url: string, method: string = 'GET', body?: Record<string, unknown>): Promise<T> {
        const token = await this.getValidToken();
        const response = await requestUrl({
            url,
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (method === 'DELETE' || response.status === 204) {
            return undefined as unknown as T;
        }

        return response.json as T;
    }

    async getCollection<T>(url: string): Promise<T[]> {
        const items: T[] = [];
        let nextUrl: string | undefined = url;

        while (nextUrl) {
            const page: GraphCollection<T> = await this.request<GraphCollection<T>>(nextUrl);
            items.push(...page.value);
            nextUrl = page['@odata.nextLink'];
        }

        return items;
    }

    async getTaskLists(): Promise<TodoList[]> {
        const lists = await this.getCollection<TodoList>(`${GRAPH_ENDPOINT}/me/todo/lists`);
        return lists.filter((list) => list.wellknownListName !== 'flaggedEmails');
    }

    async getTasks(listId: string, includeCompleted: boolean = false): Promise<TodoTask[]> {
        const filter = includeCompleted ? '' : '&$filter=status ne \'completed\'';
        const url = `${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks?$top=100&$expand=checklistItems,linkedResources${filter}`;
        return this.getCollection<TodoTask>(url);
    }

    async createTaskList(displayName: string): Promise<TodoList> {
        return this.request<TodoList>(`${GRAPH_ENDPOINT}/me/todo/lists`, 'POST', { displayName });
    }

    async deleteTaskList(listId: string): Promise<void> {
        await this.request<void>(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}`, 'DELETE');
    }

    async createTask(listId: string, title: string): Promise<TodoTask> {
        return this.request<TodoTask>(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks`, 'POST', { title });
    }

    async deleteTask(listId: string, taskId: string): Promise<void> {
        await this.request<void>(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks/${taskId}`, 'DELETE');
    }

    async createChecklistItem(listId: string, taskId: string, displayName: string): Promise<ChecklistItem> {
        return this.request<ChecklistItem>(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`, 'POST', { displayName });
    }

    async updateChecklistItem(
        listId: string,
        taskId: string,
        itemId: string,
        payload: { displayName?: string; isChecked?: boolean },
    ): Promise<ChecklistItem> {
        return this.request<ChecklistItem>(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, 'PATCH', payload as Record<string, unknown>);
    }

    async deleteChecklistItem(listId: string, taskId: string, itemId: string): Promise<void> {
        await this.request<void>(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`, 'DELETE');
    }

    async updateTask(listId: string, taskId: string, payload: UpdateTaskPayload): Promise<TodoTask> {
        return this.request<TodoTask>(`${GRAPH_ENDPOINT}/me/todo/lists/${listId}/tasks/${taskId}`, 'PATCH', payload as Record<string, unknown>);
    }

    async completeTask(listId: string, taskId: string): Promise<TodoTask> {
        return this.updateTask(listId, taskId, { status: 'completed' });
    }

    async reopenTask(listId: string, taskId: string): Promise<TodoTask> {
        return this.updateTask(listId, taskId, { status: 'notStarted' });
    }

    async updateTaskBody(listId: string, taskId: string, content: string): Promise<TodoTask> {
        return this.updateTask(listId, taskId, { body: { content, contentType: 'text' } });
    }

    async updateTaskDueDate(listId: string, taskId: string, date: string): Promise<TodoTask> {
        const dueDateTime = date ? { dateTime: `${date}T00:00:00`, timeZone: 'UTC' } : null;
        return this.updateTask(listId, taskId, { dueDateTime });
    }

    async toggleImportant(listId: string, task: TodoTask): Promise<TodoTask> {
        return this.updateTask(listId, task.id, { importance: task.importance === 'high' ? 'normal' : 'high' });
    }

    private async ensureSyncFolderExists(path: string) {
        const folder = path.split('/').slice(0, -1).join('/');
        if (!folder) return;
        if (await this.plugin.app.vault.adapter.exists(folder)) return;
        let acc = '';
        for (const part of folder.split('/')) {
            acc = acc ? `${acc}/${part}` : part;
            if (await this.plugin.app.vault.adapter.exists(acc)) continue;
            try {
                await this.plugin.app.vault.createFolder(acc);
            } catch (error) {
                // 忽略：文件夹可能已被并发创建
            }
        }
    }

    async syncAllTasksToMarkdown(): Promise<{ path: string; listCount: number; taskCount: number }> {
        const lists = await this.getTaskLists();
        const listsWithTasks = await Promise.all(lists.map(async (list) => ({
            list,
            tasks: await this.getTasks(list.id, true),
        })));
        const markdown = buildMarkdownDocument(listsWithTasks);
        const targetPath = normalizePath(this.plugin.settings.markdownSyncPath || 'Microsoft To Do.md');
        await this.ensureSyncFolderExists(targetPath);
        await this.plugin.app.vault.adapter.write(targetPath, markdown);
        const taskCount = listsWithTasks.reduce((sum, item) => sum + item.tasks.length, 0);
        return { path: targetPath, listCount: lists.length, taskCount };
    }
}
