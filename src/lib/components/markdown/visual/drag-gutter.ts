export interface DragGutterHandle {
	element: HTMLDivElement;
	/** Wire this into the dragHandle extension's onNodeChange once the editor boots. */
	setHoveredPos: (pos: number | null) => void;
	getHoveredPos: () => number | null;
	/** Called when the "+" button is pressed. Receives the hovered block position, or null
	 * if no block is currently hovered (caller should fall back to inserting at selection).
	 * Set once the editor instance exists, since the gutter DOM must be built before boot
	 * (it's passed to the DragHandle extension's `render` option). */
	setOnAddBlock: (fn: (hoveredPos: number | null) => void) => void;
	/** Called when the drag handle is clicked (not dragged — see 4px movement threshold
	 * below) with the hovered block position and the handle element (for menu anchoring). */
	setOnHandleClick: (fn: (hoveredPos: number | null, handleEl: HTMLElement) => void) => void;
	/** Toggle a class that keeps the gutter visible while a menu anchored to it is open. */
	setOpen: (open: boolean) => void;
}

/** Native HTML5 drag-and-drop suppresses `mouseup` on the source element once a drag has
 * actually started, so this threshold — not the `click` event — is what distinguishes a
 * click (open the block menu) from a drag (reorder the block). */
const CLICK_MOVEMENT_THRESHOLD = 4;

/** Builds the Notion-style per-block gutter (drag handle + "+" button) shared by
 * NotionEditor and NotebookDocumentEditor. Both components render this DOM node via
 * the DragHandle extension's `render` option. */
export function createDragGutter(): DragGutterHandle {
	const el = document.createElement('div');
	el.className = 'notion-drag-gutter';
	el.innerHTML = `
		<button type="button" class="notion-plus-btn" title="Add block below" aria-label="Add block" data-testid="add-block">
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
		</button>
		<div class="notion-drag-handle" data-drag-handle draggable="true" title="Drag to reorder, click for menu">
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
		</div>
	`;

	let hoveredPos: number | null = null;
	let onAddBlock: ((hoveredPos: number | null) => void) | null = null;
	let onHandleClick: ((hoveredPos: number | null, handleEl: HTMLElement) => void) | null = null;
	let downPos: { x: number; y: number } | null = null;

	el.querySelector('.notion-plus-btn')?.addEventListener('mousedown', (e) => {
		e.preventDefault();
		e.stopPropagation();
		onAddBlock?.(hoveredPos);
	});

	const handleEl = el.querySelector('.notion-drag-handle') as HTMLElement | null;
	handleEl?.addEventListener('mousedown', (e) => {
		downPos = { x: e.clientX, y: e.clientY };
	});
	handleEl?.addEventListener('mouseup', (e) => {
		if (!downPos) return;
		const dx = e.clientX - downPos.x;
		const dy = e.clientY - downPos.y;
		downPos = null;
		if (Math.hypot(dx, dy) < CLICK_MOVEMENT_THRESHOLD) {
			onHandleClick?.(hoveredPos, handleEl);
		}
	});

	return {
		element: el,
		setHoveredPos: (pos) => {
			hoveredPos = pos;
		},
		getHoveredPos: () => hoveredPos,
		setOnAddBlock: (fn) => {
			onAddBlock = fn;
		},
		setOnHandleClick: (fn) => {
			onHandleClick = fn;
		},
		setOpen: (open) => {
			el.classList.toggle('is-open', open);
		}
	};
}
