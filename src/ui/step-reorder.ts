import type { Component } from 'obsidian';

export function attachStepReorder(
    owner: Component, container: HTMLElement, isDisabled: () => boolean,
    save: (ids: string[]) => void,
) {
    const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.todo-step-row'));
    let drag: { row: HTMLElement; pointerId: number; startY: number; original: HTMLElement[]; moved: boolean } | null = null;
    const finish = (cancel: boolean) => {
        if (!drag) return;
        const current = drag;
        drag = null;
        current.row.removeClass('is-dragging');
        if (cancel) current.original.forEach(row => container.appendChild(row));
        if (container.hasPointerCapture(current.pointerId)) container.releasePointerCapture(current.pointerId);
        if (!cancel && current.moved) save(rows().map(row => row.getAttr('data-step-id')!));
    };
    owner.register(() => finish(true));
    rows().forEach(row => {
        const handle = row.querySelector<HTMLButtonElement>('.todo-step-drag')!;
        owner.registerDomEvent(handle, 'pointerdown', event => {
            if (event.button !== 0 || !event.isPrimary || drag || isDisabled()) return;
            event.preventDefault();
            handle.focus();
            if (!container.isConnected || isDisabled()) return;
            drag = { row, pointerId: event.pointerId, startY: event.clientY, original: rows(), moved: false };
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
            container.insertBefore(row, items[event.key === 'ArrowUp' ? target : target + 1] ?? null);
            handle.focus();
            save(rows().map(item => item.getAttr('data-step-id')!));
        });
    });
    owner.registerDomEvent(container, 'pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
        drag.moved = true;
        drag.row.addClass('is-dragging');
        const before = rows().find(row => {
            if (row === drag!.row) return false;
            const bounds = row.getBoundingClientRect();
            return event.clientY < bounds.top + bounds.height / 2;
        });
        container.insertBefore(drag.row, before ?? null);
        // Keep long checklists reachable while the pointer approaches the panel edge.
        const panel = container.closest<HTMLElement>('.todo-detail-panel');
        if (panel) {
            const bounds = panel.getBoundingClientRect();
            if (event.clientY < bounds.top + 32) panel.scrollTop -= 16;
            if (event.clientY > bounds.bottom - 32) panel.scrollTop += 16;
        }
    });
    owner.registerDomEvent(container, 'pointerup', event => {
        if (event.pointerId === drag?.pointerId) finish(false);
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
