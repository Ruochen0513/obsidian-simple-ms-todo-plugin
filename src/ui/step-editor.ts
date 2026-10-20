import { Scope, type App, type Component } from 'obsidian';
import { t } from '../i18n';

export function attachStepEditor(
    app: App, owner: Component, label: HTMLElement, name: string, drafts: Map<string, string>, key: string,
    isPending: () => boolean, save: (name: string, restoreFocus: boolean) => void, parentScope?: Scope | null,
) {
    const input = label.createEl('textarea', { cls: 'todo-step-edit-input' });
    const text = label.createSpan({ text: name, cls: 'todo-step-text' });
    input.rows = 1;
    input.maxLength = 255;
    input.setAttr('aria-label', t('taskDetail.editStepAria', { stepName: name }));
    label.tabIndex = 0;
    label.setAttr('role', 'button');
    label.setAttr('aria-label', t('taskDetail.editStepAria', { stepName: name }));
    label.setAttr('title', t('taskDetail.editStepHint'));
    let editing = drafts.has(key);
    let disposed = false;
    const scope = new Scope(parentScope ?? app.scope);
    let scoped = false;
    const releaseScope = () => {
        if (scoped) app.keymap.popScope(scope);
        scoped = false;
    };
    owner.register(() => { disposed = true; releaseScope(); });

    const display = () => {
        input.hidden = !editing;
        text.hidden = editing;
        label.tabIndex = editing ? -1 : 0;
        label.setAttr('role', editing ? 'group' : 'button');
        label.toggleClass('is-editing', editing);
    };
    input.value = drafts.get(key) ?? name;
    display();
    const begin = () => {
        if (disposed || editing || isPending()) return;
        editing = true;
        drafts.set(key, name);
        input.value = name;
        display();
        input.focus();
        input.select();
    };
    const finish = (cancel: boolean, restoreFocus: boolean) => {
        if (!editing || disposed || isPending()) return;
        const next = input.value.trim();
        editing = false;
        releaseScope();
        drafts.delete(key);
        display();
        if (restoreFocus) label.focus();
        if (!cancel && next && next !== name) save(next, restoreFocus);
    };
    scope.register([], 'Escape', event => {
        if (event.isComposing) return;
        finish(true, true);
        return false;
    });
    owner.registerDomEvent(label, 'dblclick', event => {
        if (editing) return;
        event.preventDefault();
        begin();
    });
    owner.registerDomEvent(label, 'keydown', event => {
        if (event.target === input || event.isComposing) return;
        if (event.key === 'Enter' || event.key === 'F2' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            begin();
        }
    });
    owner.registerDomEvent(input, 'input', () => drafts.set(key, input.value));
    owner.registerDomEvent(input, 'focus', () => {
        if (scoped) return;
        app.keymap.pushScope(scope);
        scoped = true;
    });
    owner.registerDomEvent(input, 'blur', () => finish(false, false));
    owner.registerDomEvent(input, 'keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            finish(event.key === 'Escape', true);
        }
    });
}
