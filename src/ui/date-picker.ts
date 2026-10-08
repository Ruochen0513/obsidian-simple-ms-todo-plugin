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
    const win = input.ownerDocument.defaultView ?? window;
    const scope = new Scope(parentScope || app.scope);
    let scopeActive = false;
    let pointerOpening = false;
    let openingFrame: number | null = null;
    let openingAnimation: Animation | undefined;
    const releaseScope = () => {
        if (openingFrame !== null) win.cancelAnimationFrame(openingFrame);
        openingFrame = null;
        openingAnimation?.cancel();
        openingAnimation = undefined;
        pointerOpening = false;
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
        clickOpens: false,
        animate: false,
        appendTo: input.closest<HTMLElement>('.modal-container') || input.ownerDocument.body,
        onOpen: () => {
            if (!scopeActive) app.keymap.pushScope(scope);
            scopeActive = true;
            input.setAttr('aria-expanded', 'true');
            if (!pointerOpening) return;
            pointerOpening = false;
            // Flatpickr positions the calendar after onOpen; animate before the next paint.
            openingFrame = win.requestAnimationFrame(() => {
                openingFrame = null;
                const above = calendar.hasClass('arrowBottom');
                calendar.style.transformOrigin = `${calendar.hasClass('rightMost') ? 'right' : 'left'} ${above ? 'bottom' : 'top'}`;
                const frames: Keyframe[] = win.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? [{ opacity: 0 }, { opacity: 1 }]
                    : [{ opacity: 0, transform: `translateY(${above ? 4 : -4}px) scale(0.97)` }, { opacity: 1, transform: 'none' }];
                openingAnimation = calendar.animate(frames, { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
            });
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
    component.registerDomEvent(input, 'pointerdown', () => { pointerOpening = true; });
    component.registerDomEvent(input, 'click', () => { picker.toggle(); });
    component.registerDomEvent(input, 'keydown', event => {
        pointerOpening = false;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        // Handle activation before Flatpickr's Enter listener can open it again.
        event.stopImmediatePropagation();
        picker.toggle();
    }, true);
    component.registerDomEvent(input, 'blur', () => { pointerOpening = false; });

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
