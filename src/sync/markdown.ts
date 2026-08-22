import type { TodoList, TodoTask } from '../api/ms-todo-api';
import { t } from '../i18n';

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

    const body = htmlToMarkdown(task.body?.content || '').trim();
    if (body) {
        body.split('\n').forEach((line) => {
            lines.push(`  > ${line || ' '}`);
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

function htmlToMarkdown(value: string): string {
    return value
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/p>\s*<p>/gi, '\n\n')
        .replace(/<\/div>\s*<div>/gi, '\n')
        .replace(/<\/?p[^>]*>/gi, '')
        .replace(/<\/?div[^>]*>/gi, '')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/?ul[^>]*>/gi, '')
        .replace(/<\/?ol[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}

function escapeMarkdown(value: string): string {
    return value.replace(/\n/g, ' ').trim();
}
