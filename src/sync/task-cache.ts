import type { TodoList, TodoTask } from '../api/ms-todo-api';

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

export function isValidTaskCacheSnapshot(value: unknown): value is TaskCacheSnapshot {
    if (!value || typeof value !== 'object') return false;
    const snapshot = value as Partial<TaskCacheSnapshot>;
    if (snapshot.version !== 1) return false;
    if (!Array.isArray(snapshot.lists) || snapshot.lists.length === 0) return false;
    if (!snapshot.lists.every((list) => !!list && typeof list.id === 'string' && typeof list.displayName === 'string')) return false;
    if (!snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries)) return false;
    return Object.values(snapshot.entries).every((entry) =>
        !!entry && Array.isArray(entry.tasks) && typeof entry.allLoaded === 'boolean' && typeof entry.updatedAt === 'number');
}
