import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';

/** Max vertical distance (px) from a block-gap midline before the insert
 * affordance shows. Keeps the hit zone tight so it doesn't fight normal
 * hovering over the blocks themselves. */
const GAP_THRESHOLD = 6;

const EXCLUDE_SELECTOR = '.query-block-view, [data-drag-handle], .notion-drag-gutter';

/** Inserts a "/" paragraph at `pos` and opens the slash menu there — the same
 * insert-and-trigger-slash pattern used by the per-block "+" button, but
 * anchored at an arbitrary document position rather than after a specific node. */
function insertSlashAt(editor: Editor, pos: number) {
	editor
		.chain()
		.focus()
		.insertContentAt(pos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
		.setTextSelection(pos + 2)
		.run();
}

class BlockInsertLineView {
	private readonly host: HTMLElement;
	private readonly overlay: HTMLDivElement;
	private activePos: number | null = null;
	private dragging = false;
	private view: EditorView;

	constructor(
		view: EditorView,
		private readonly editor: Editor
	) {
		this.view = view;
		this.host = (view.dom.parentElement as HTMLElement | null) ?? view.dom;

		this.overlay = document.createElement('div');
		this.overlay.className = 'block-insert-line';
		this.overlay.innerHTML = `
			<button type="button" class="block-insert-line-chip" aria-label="Insert block here">
				<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
			</button>
			<div class="block-insert-line-bar"></div>
		`;
		this.overlay.style.display = 'none';
		this.host.appendChild(this.overlay);

		this.onMouseMove = this.onMouseMove.bind(this);
		this.onMouseLeave = this.onMouseLeave.bind(this);
		this.onDragStart = this.onDragStart.bind(this);
		this.onDragEnd = this.onDragEnd.bind(this);
		this.onClick = this.onClick.bind(this);

		this.host.addEventListener('mousemove', this.onMouseMove);
		this.host.addEventListener('mouseleave', this.onMouseLeave);
		this.host.addEventListener('dragstart', this.onDragStart, true);
		this.host.addEventListener('dragend', this.onDragEnd, true);
		this.host.addEventListener('drop', this.onDragEnd, true);
		this.overlay.addEventListener('mousedown', this.onClick);
	}

	private hide() {
		this.activePos = null;
		this.overlay.style.display = 'none';
	}

	private onDragStart() {
		this.dragging = true;
		this.hide();
	}

	private onDragEnd() {
		this.dragging = false;
	}

	private onMouseLeave() {
		this.hide();
	}

	private onClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (this.activePos === null) return;
		insertSlashAt(this.editor, this.activePos);
		this.hide();
	}

	private onMouseMove(e: MouseEvent) {
		if (this.dragging) {
			this.hide();
			return;
		}
		const target = e.target as HTMLElement | null;
		if (target?.closest(EXCLUDE_SELECTOR)) {
			this.hide();
			return;
		}
		const hostRect = this.host.getBoundingClientRect();
		if (e.clientX < hostRect.left || e.clientX > hostRect.right) {
			this.hide();
			return;
		}

		const { doc } = this.view.state;
		const offsets: number[] = [];
		doc.forEach((_node, offset) => offsets.push(offset));
		offsets.push(doc.content.size);

		let bestPos: number | null = null;
		let bestMid = 0;
		let bestDist = Infinity;
		for (let i = 1; i < offsets.length - 1; i++) {
			const prevDom = this.view.nodeDOM(offsets[i - 1]) as HTMLElement | null;
			const nextDom = this.view.nodeDOM(offsets[i]) as HTMLElement | null;
			if (!(prevDom instanceof HTMLElement) || !(nextDom instanceof HTMLElement)) continue;
			const prevRect = prevDom.getBoundingClientRect();
			const nextRect = nextDom.getBoundingClientRect();
			const mid = (prevRect.bottom + nextRect.top) / 2;
			const dist = Math.abs(e.clientY - mid);
			if (dist < bestDist) {
				bestDist = dist;
				bestMid = mid;
				bestPos = offsets[i];
			}
		}

		if (bestPos === null || bestDist > GAP_THRESHOLD) {
			this.hide();
			return;
		}
		this.activePos = bestPos;
		this.overlay.style.display = 'flex';
		this.overlay.style.top = `${bestMid - hostRect.top}px`;
	}

	update(view: EditorView) {
		this.view = view;
		if (this.activePos !== null) this.hide();
	}

	destroy() {
		this.host.removeEventListener('mousemove', this.onMouseMove);
		this.host.removeEventListener('mouseleave', this.onMouseLeave);
		this.host.removeEventListener('dragstart', this.onDragStart, true);
		this.host.removeEventListener('dragend', this.onDragEnd, true);
		this.host.removeEventListener('drop', this.onDragEnd, true);
		this.overlay.remove();
	}
}

export const BlockInsertLineExtension = Extension.create({
	name: 'blockInsertLine',
	addProseMirrorPlugins() {
		const editor = this.editor;
		return [
			new Plugin({
				key: new PluginKey('blockInsertLine'),
				view(editorView) {
					return new BlockInsertLineView(editorView, editor);
				}
			})
		];
	}
});
