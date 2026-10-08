import type { TodoList, TodoTask } from '../api/ms-todo-api';
import { t } from '../i18n';
import { taskBodyText } from '../utils/task-body';

interface ListWithTasks {
    list: TodoList;
    tasks: TodoTask[];
}

export function buildMarkdownDocument(listsWithTasks: ListWithTasks[]): string {
    const lines: string[] = [
        '# Microsoft To Do',
        '',
        t('markdownBlock.syncTimestamp', { date: new Date().toLocaleString() }),
        '',
    ];

    listsWithTasks.forEach(({ list, tasks }) => {
        lines.push(`## ${escapeMarkdown(list.displayName)}`, '');

        if (tasks.length === 0) {
            lines.push(t('markdownBlock.noTasks'), '');
            return;
        }

        tasks.forEach((task) => appendTask(lines, task));
        lines.push('');
    });

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function appendTask(lines: string[], task: TodoTask) {
    const checked = task.status === 'completed' ? 'x' : ' ';
    const metadata = buildMetadata(task);
    lines.push(`- [${checked}] ${escapeMarkdown(task.title)}${metadata ? ` ${metadata}` : ''}`);

    const body = taskBodyText(task.body).trim();
    if (body) {
        body.split('\n').forEach((line) => {
            const escaped = line.replace(/&/g, '&amp;').replace(/[\\`*_{}\[\]()#+.!|<>~=-]/g, '\\$&');
            lines.push(`  > ${escaped || ' '}`);
        });
    }

    if (task.checklistItems && task.checklistItems.length > 0) {
        task.checklistItems.forEach((item) => {
            lines.push(`  - [${item.isChecked ? 'x' : ' '}] ${escapeMarkdown(item.displayName)}`);
        });
    }

    if (task.linkedResources && task.linkedResources.length > 0) {
        task.linkedResources.forEach((resource) => {
            const label = resource.displayName || resource.applicationName || resource.webUrl || t('markdownBlock.linkedResource');
            if (resource.webUrl) {
                lines.push(`  - ${escapeMarkdown(label)}${t('markdownBlock.resourceUrlSeparator')}${resource.webUrl}`);
            } else {
                lines.push(`  - ${escapeMarkdown(label)}`);
            }
        });
    }
}

function buildMetadata(task: TodoTask): string {
    const metadata: string[] = [];
    if (task.importance === 'high') metadata.push(t('markdownBlock.important'));
    if (task.dueDateTime?.dateTime) metadata.push(t('markdownBlock.duePrefix', { date: formatDate(task.dueDateTime.dateTime) }));
    if (task.reminderDateTime?.dateTime) metadata.push(t('markdownBlock.reminderPrefix', { date: formatDate(task.reminderDateTime.dateTime) }));
    return metadata.length > 0 ? `${t('markdownBlock.metadataOpen')}${metadata.join(t('markdownBlock.metadataJoiner'))}${t('markdownBlock.metadataClose')}` : '';
}

function formatDate(value: string): string {
    return value.includes('T') ? (value.split('T')[0] || value) : value;
}

function escapeMarkdown(value: string): string {
    return value.replace(/\n/g, ' ').trim();
}
