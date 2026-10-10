import type { TodoTask } from '../api/ms-todo-api';

export type ChecklistOrders = Record<string, string[]>;

export function checklistOrderKey(listId: string, taskId: string): string {
    return JSON.stringify([listId, taskId]);
}

export function readChecklistOrders(value: unknown): ChecklistOrders {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, ids]) =>
        Array.isArray(ids) && ids.every(id => typeof id === 'string')));
}

export function applyChecklistOrder(task: TodoTask, listId: string, orders: ChecklistOrders) {
    const order = orders[checklistOrderKey(listId, task.id)];
    if (!Array.isArray(order) || !task.checklistItems) return;
    const positions = new Map(order.map((id, index) => [id, index]));
    task.checklistItems = [...task.checklistItems].sort((a, b) =>
        (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
}
