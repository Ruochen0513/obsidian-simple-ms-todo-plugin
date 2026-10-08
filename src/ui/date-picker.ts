/*!
Flatpickr — The MIT License (MIT)

Copyright (c) 2017 Gregory Petrosyan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { Component, Scope, setIcon, type App } from 'obsidian';
import flatpickr from 'flatpickr';
import { Mandarin } from 'flatpickr/dist/l10n/zh';
import { getLocale, t } from '../i18n';

export function attachDatePicker(app: App, owner: Component, input: HTMLInputElement, parentScope?: Scope | null): () => void {
    const component = owner.addChild(new Component());
    const scope = new Scope(parentScope || app.scope);
    let scopeActive = false;
    const releaseScope = () => {
        if (scopeActive) app.keymap.popScope(scope);
        scopeActive = false;
        input.setAttr('aria-expanded', 'false');
    };
    const chinese = getLocale() === 'zh-cn';
    const picker = flatpickr(input, {
        dateFormat: 'Y-m-d',
        ariaDateFormat: chinese ? 'Y年n月j日' : 'F j, Y',
        locale: { ...(chinese ? Mandarin : {}), firstDayOfWeek: 1 },
        monthSelectorType: 'static',
        disableMobile: true,
        animate: false,
        appendTo: input.closest<HTMLElement>('.modal-container') || input.ownerDocument.body,
        onOpen: () => {
            if (!scopeActive) app.keymap.pushScope(scope);
            scopeActive = true;
            input.setAttr('aria-expanded', 'true');
        },
        onClose: releaseScope,
        onDayCreate: (_dates, _value, _picker, day) => {
            day.setAttribute('role', 'button');
            day.setAttribute('aria-pressed', String(day.classList.contains('selected')));
        },
    });
    input.setAttr('placeholder', t('calendar.chooseDate'));
    input.setAttr('aria-haspopup', 'dialog');
    input.setAttr('aria-expanded', 'false');
    input.addClass('todo-calendar-input');
    const calendar = picker.calendarContainer;
    calendar.addClass('todo-calendar');
    calendar.toggleClass('is-chinese', chinese);
    calendar.setAttr('role', 'dialog');
    calendar.setAttr('aria-label', t('taskDetail.dueDateLabel'));
    picker.currentYearElement.setAttr('aria-label', t('calendar.year'));

    for (const [arrow, delta, label, icon] of [
        [picker.prevMonthNav, -1, t('calendar.previousMonth'), 'chevron-left'],
        [picker.nextMonthNav, 1, t('calendar.nextMonth'), 'chevron-right'],
    ] as const) {
        arrow.setAttr('role', 'button');
        arrow.setAttr('tabindex', '0');
        arrow.setAttr('aria-label', label);
        setIcon(arrow, icon);
        component.registerDomEvent(arrow, 'keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            picker.changeMonth(delta);
        });
    }
    const footer = calendar.createDiv({ cls: 'todo-calendar-footer' });
    const dismiss = () => { input.focus(); picker.close(); };
    component.registerDomEvent(footer, 'keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    const clear = footer.createEl('button', { text: t('calendar.clear'), attr: { type: 'button' } });
    clear.onclick = () => { picker.clear(); dismiss(); };
    const today = footer.createEl('button', { text: t('date.today'), attr: { type: 'button' } });
    today.onclick = () => { picker.setDate(new Date(), true); dismiss(); };

    scope.register([], 'Escape', () => {
        dismiss();
        return false;
    });
    // Scrolling a sidebar or modal should not leave its calendar floating over another field.
    component.registerDomEvent(input.ownerDocument, 'scroll', event => {
        if (picker.isOpen && !calendar.contains(event.target as Node)) picker.close();
    }, true);
    component.register(() => {
        releaseScope();
        picker.destroy();
    });
    return () => owner.removeChild(component);
}
