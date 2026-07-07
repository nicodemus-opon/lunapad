import type { EditorView } from '@tiptap/pm/view';

/** Reads a File as a data URL and inserts it as an image node at `pos`. Shared by drag-drop
 * and paste handling so both editors get identical image-insert behavior. */
function insertImageFile(view: EditorView, file: File, pos: number): void {
	const reader = new FileReader();
	reader.onload = () => {
		const src = reader.result;
		if (typeof src !== 'string') return;
		const node = view.state.schema.nodes.image?.create({ src });
		if (!node) return;
		view.dispatch(view.state.tr.insert(pos, node));
	};
	reader.readAsDataURL(file);
}

/** `editorProps.handleDOMEvents.drop` — drop an image file onto the document at the drop
 * point. Returns false (unhandled) for non-image drops so ProseMirror's default handling
 * (e.g. reordering dragged blocks) still applies. */
export function handleImageDrop(view: EditorView, event: Event): boolean {
	const dragEvent = event as DragEvent;
	const files = dragEvent.dataTransfer?.files;
	if (!files?.length) return false;
	const file = files[0];
	if (!file.type.startsWith('image/')) return false;
	event.preventDefault();
	const pos = view.posAtCoords({ left: dragEvent.clientX, top: dragEvent.clientY })?.pos;
	if (pos === undefined) return false;
	insertImageFile(view, file, pos);
	return true;
}

/** `editorProps.handleDOMEvents.paste` — insert a pasted image (e.g. from a screenshot
 * clipboard) at the current selection. */
export function handleImagePaste(view: EditorView, event: Event): boolean {
	const clipboardEvent = event as ClipboardEvent;
	const files = clipboardEvent.clipboardData?.files;
	if (!files?.length) return false;
	const file = files[0];
	if (!file.type.startsWith('image/')) return false;
	event.preventDefault();
	insertImageFile(view, file, view.state.selection.from);
	return true;
}
