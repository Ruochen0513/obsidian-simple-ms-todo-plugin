import type { Component } from 'obsidian';

export function attachStepReorder(
    owner: Component, container: HTMLElement, isDisabled: () => boolean,
    save: (ids: string[]) => void,
) {
    const win = container.ownerDocument.defaultView ?? window;
    const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
    const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.todo-step-row'));
    const animations = new Map<HTMLElement, Animation>();
    const layoutTop = (row: HTMLElement) => container.getBoundingClientRect().top + row.offsetTop - container.scrollTop;
    let frame: number | null = null;
    let lastFrame = 0;
    let drag: {
        row: HTMLElement; pointerId: number; startY: number; clientY: number;
        grabOffset: number; original: HTMLElement[]; moved: boolean;
    } | null = null;

    const animateFrom = (row: HTMLElement, top: number) => {
        animations.get(row)?.cancel();
        animations.delete(row);
        const offset = top - layoutTop(row);
        if (reducedMotion.matches || Math.abs(offset) < 1) return;
        const animation = row.animate([
            { transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' },
        ], { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        animations.set(row, animation);
        animation.onfinish = () => { if (animations.get(row) === animation) animations.delete(row); };
    };
    const moveRows = (move: () => void, skip?: HTMLElement) => {
        const tops = new Map(rows().map(row => [row, row.getBoundingClientRect().top]));
        animations.forEach(animation => animation.cancel());
        animations.clear();
        move();
        tops.forEach((top, row) => { if (row !== skip) animateFrom(row, top); });
    };
    const updateDrag = () => {
        if (!drag?.moved) return;
        const current = drag;
        const bounds = container.getBoundingClientRect();
        const height = current.row.offsetHeight;
        const top = Math.max(bounds.top, Math.min(current.clientY - current.grabOffset, bounds.bottom - height));
        const center = top + height / 2;
        const items = rows();
        const before = items.find(row => row !== current.row && center <= layoutTop(row) + row.offsetHeight / 2);
        if (current.row.nextElementSibling !== (before ?? null)) {
            moveRows(() => container.insertBefore(current.row, before ?? null), current.row);
        }
        current.row.style.transform = `translateY(${top - layoutTop(current.row)}px)`;
    };
    const tick = (time: number) => {
        frame = null;
        if (!drag?.moved) return;
        const elapsed = lastFrame ? Math.min(time - lastFrame, 32) : 16;
        lastFrame = time;
        const bounds = container.getBoundingClientRect();
        const edge = 32;
        const speed = drag.clientY < bounds.top + edge
            ? -Math.min(1, (bounds.top + edge - drag.clientY) / edge)
            : Math.max(0, Math.min(1, (drag.clientY - bounds.bottom + edge) / edge));
        container.scrollTop += speed * elapsed * 0.4;
        updateDrag();
        frame = win.requestAnimationFrame(tick);
    };
    const finish = (cancel: boolean, animate = true) => {
        if (!drag) return;
        const current = drag;
        const top = current.row.getBoundingClientRect().top;
        drag = null;
        if (frame !== null) win.cancelAnimationFrame(frame);
        frame = null;
        lastFrame = 0;
        current.row.setCssStyles({ transform: '' });
        current.row.removeClass('is-dragging');
        container.removeClass('is-reordering');
        if (cancel) {
            const restore = () => current.original.forEach(row => container.appendChild(row));
            if (animate) moveRows(restore, current.row);
            else restore();
        }
        if (animate) animateFrom(current.row, top);
        if (container.hasPointerCapture(current.pointerId)) container.releasePointerCapture(current.pointerId);
        if (!cancel && current.moved) save(rows().map(row => row.getAttr('data-step-id')!));
    };
    owner.register(() => {
        finish(true, false);
        animations.forEach(animation => animation.cancel());
        animations.clear();
    });
    rows().forEach(row => {
        const handle = row.querySelector<HTMLButtonElement>('.todo-step-drag')!;
        owner.registerDomEvent(handle, 'pointerdown', event => {
            if (event.button !== 0 || !event.isPrimary || drag || isDisabled()) return;
            event.preventDefault();
            handle.focus({ preventScroll: true });
            if (!container.isConnected || isDisabled()) return;
            const top = row.getBoundingClientRect().top;
            animations.get(row)?.cancel();
            animations.delete(row);
            row.style.transform = `translateY(${top - layoutTop(row)}px)`;
            drag = { row, pointerId: event.pointerId, startY: event.clientY, clientY: event.clientY,
                grabOffset: event.clientY - top, original: rows(), moved: false };
            container.setPointerCapture(event.pointerId);
        });
        owner.registerDomEvent(handle, 'keydown', event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            event.stopPropagation();
            if (isDisabled() || drag) return;
            const items = rows();
            const index = items.indexOf(row);
            const target = index + (event.key === 'ArrowUp' ? -1 : 1);
            if (target < 0 || target >= items.length) return;
            animations.forEach(animation => animation.cancel());
            animations.clear();
            container.insertBefore(row, items[event.key === 'ArrowUp' ? target : target + 1] ?? null);
            handle.focus({ preventScroll: true });
            row.scrollIntoView({ block: 'nearest' });
            save(rows().map(item => item.getAttr('data-step-id')!));
        });
    });
    owner.registerDomEvent(container, 'pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.clientY = event.clientY;
        if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
        drag.moved = true;
        drag.row.addClass('is-dragging');
        container.addClass('is-reordering');
        updateDrag();
        if (frame === null) frame = win.requestAnimationFrame(tick);
    });
    owner.registerDomEvent(container, 'pointerup', event => {
        if (event.pointerId !== drag?.pointerId) return;
        drag.clientY = event.clientY;
        updateDrag();
        finish(false);
    });
    for (const name of ['pointercancel', 'lostpointercapture'] as const) {
        owner.registerDomEvent(container, name, event => {
            if (event.pointerId === drag?.pointerId) finish(true);
        });
    }
    owner.registerDomEvent(container, 'keydown', event => {
        if (event.key !== 'Escape' || !drag) return;
        event.preventDefault();
        event.stopPropagation();
        finish(true);
    });
}
