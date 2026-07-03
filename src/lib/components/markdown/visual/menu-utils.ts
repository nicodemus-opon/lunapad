/** Shared positioning and keyboard behavior for editor popovers. */

export interface MenuPosition {
	top: number;
	left: number;
}

export interface MenuAnchorRect {
	top: number;
	left: number;
	bottom: number;
	right?: number;
}

export function clampMenuPosition(
	anchor: MenuAnchorRect,
	size: { width: number; height: number },
	gap = 6,
	margin = 8
): MenuPosition {
	let left = anchor.left;
	let top = anchor.bottom + gap;

	if (left + size.width > window.innerWidth - margin) {
		left = window.innerWidth - size.width - margin;
	}
	if (left < margin) left = margin;

	if (top + size.height > window.innerHeight - margin) {
		top = anchor.top - size.height - gap;
	}
	if (top < margin) top = margin;

	return { top, left };
}

export function clampContextMenuPosition(
	clientX: number,
	clientY: number,
	size: { width: number; height: number },
	margin = 8
): MenuPosition {
	let left = clientX;
	let top = clientY;

	if (left + size.width > window.innerWidth - margin) {
		left = window.innerWidth - size.width - margin;
	}
	if (left < margin) left = margin;

	if (top + size.height > window.innerHeight - margin) {
		top = window.innerHeight - size.height - margin;
	}
	if (top < margin) top = margin;

	return { top, left };
}

/** Scroll a menu item into view with padding at top/bottom of the scroll container. */
export function scrollMenuItemIntoView(
	listEl: HTMLElement,
	itemEl: HTMLElement,
	padding = 8
): void {
	const listTop = listEl.scrollTop;
	const listBottom = listTop + listEl.clientHeight;
	const itemTop = itemEl.offsetTop;
	const itemBottom = itemTop + itemEl.offsetHeight;

	if (itemTop < listTop + padding) {
		listEl.scrollTop = itemTop - padding;
	} else if (itemBottom > listBottom - padding) {
		listEl.scrollTop = itemBottom - listEl.clientHeight + padding;
	}
}

export interface MenuKeyboardOptions {
	itemCount: () => number;
	getSelectedIndex: () => number;
	setSelectedIndex: (index: number) => void;
	selectAt: (index: number) => void;
	close: () => void;
	/** When true, arrow keys wrap (default false). */
	loop?: boolean;
}

export function handleMenuKeyDown(e: KeyboardEvent, opts: MenuKeyboardOptions): boolean {
	const count = opts.itemCount();
	if (!count) return false;

	const selected = opts.getSelectedIndex();
	const loop = opts.loop ?? false;

	if (e.key === 'ArrowDown') {
		e.preventDefault();
		if (selected >= count - 1) {
			opts.setSelectedIndex(loop ? 0 : count - 1);
		} else {
			opts.setSelectedIndex(selected + 1);
		}
		return true;
	}

	if (e.key === 'ArrowUp') {
		e.preventDefault();
		if (selected <= 0) {
			opts.setSelectedIndex(loop ? count - 1 : 0);
		} else {
			opts.setSelectedIndex(selected - 1);
		}
		return true;
	}

	if (e.key === 'Enter' || e.key === 'Tab') {
		e.preventDefault();
		opts.selectAt(selected);
		return true;
	}

	if (e.key === 'Escape') {
		e.preventDefault();
		opts.close();
		return true;
	}

	return false;
}
