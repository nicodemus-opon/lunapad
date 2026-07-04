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

export interface ClampMenuOptions {
	gap?: number;
	margin?: number;
	/** `below` for slash/mention menus; `beside` for block property popovers. */
	placement?: 'below' | 'beside';
}

/** Viewport anchor for a ProseMirror node — prefers live DOM over coordsAtPos. */
export function editorNodeAnchorRect(
	editor: import('@tiptap/core').Editor,
	pos: number
): MenuAnchorRect | null {
	const dom = editor.view.nodeDOM(pos);
	if (dom instanceof HTMLElement) {
		const rect = dom.getBoundingClientRect();
		return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
	}
	try {
		const coords = editor.view.coordsAtPos(pos);
		return {
			top: coords.top,
			left: coords.left,
			bottom: coords.bottom,
			right: coords.right
		};
	} catch {
		return null;
	}
}

function viewportSize(): { width: number; height: number } {
	if (typeof window === 'undefined') return { width: 1024, height: 768 };
	return { width: window.innerWidth, height: window.innerHeight };
}

function clampToViewport(
	pos: MenuPosition,
	size: { width: number; height: number },
	margin: number,
	vw: number,
	vh: number
): MenuPosition {
	return {
		left: Math.max(margin, Math.min(pos.left, vw - size.width - margin)),
		top: Math.max(margin, Math.min(pos.top, vh - size.height - margin))
	};
}

function fitsViewport(
	pos: MenuPosition,
	size: { width: number; height: number },
	margin: number,
	vw: number,
	vh: number
): boolean {
	return (
		pos.left >= margin &&
		pos.top >= margin &&
		pos.left + size.width <= vw - margin &&
		pos.top + size.height <= vh - margin
	);
}

/** Pick the first placement that fits; otherwise return the best clamped fallback. */
function pickPlacement(
	candidates: MenuPosition[],
	size: { width: number; height: number },
	margin: number
): MenuPosition {
	const { width: vw, height: vh } = viewportSize();
	for (const pos of candidates) {
		const clamped = clampToViewport(pos, size, margin, vw, vh);
		if (fitsViewport(clamped, size, margin, vw, vh)) return clamped;
	}
	return clampToViewport(candidates[0] ?? { top: margin, left: margin }, size, margin, vw, vh);
}

export function clampMenuPosition(
	anchor: MenuAnchorRect,
	size: { width: number; height: number },
	options: ClampMenuOptions = {}
): MenuPosition {
	const gap = options.gap ?? 6;
	const margin = options.margin ?? 8;
	const anchorRight = anchor.right ?? anchor.left;
	const anchorLeft = anchor.left;
	const anchorTop = anchor.top;
	const anchorBottom = anchor.bottom;
	const anchorMidY = anchorTop + (anchorBottom - anchorTop) / 2;

	if (options.placement === 'beside') {
		return pickPlacement(
			[
				{ left: anchorRight + gap, top: anchorTop },
				{ left: anchorLeft - size.width - gap, top: anchorTop },
				{ left: anchorRight + gap, top: anchorMidY - size.height / 2 },
				{ left: anchorLeft - size.width - gap, top: anchorMidY - size.height / 2 },
				{ left: anchorLeft, top: anchorBottom + gap },
				{ left: anchorLeft, top: anchorTop - size.height - gap }
			],
			size,
			margin
		);
	}

	return pickPlacement(
		[
			{ left: anchorLeft, top: anchorBottom + gap },
			{ left: anchorLeft, top: anchorTop - size.height - gap },
			{ left: anchorRight + gap, top: anchorTop },
			{ left: anchorLeft - size.width - gap, top: anchorTop }
		],
		size,
		margin
	);
}

export function clampContextMenuPosition(
	clientX: number,
	clientY: number,
	size: { width: number; height: number },
	margin = 8
): MenuPosition {
	const { width: vw, height: vh } = viewportSize();
	return pickPlacement(
		[
			{ left: clientX, top: clientY },
			{ left: clientX - size.width, top: clientY },
			{ left: clientX, top: clientY - size.height },
			{ left: clientX - size.width, top: clientY - size.height }
		],
		size,
		margin
	);
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
