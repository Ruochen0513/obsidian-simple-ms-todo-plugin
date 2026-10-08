import type { TodoTask } from '../api/ms-todo-api';

export function taskBodyText(body: TodoTask['body']): string {
    const value = body?.content || '';
    if (body?.contentType?.toLowerCase() !== 'html') return value;

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
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}
