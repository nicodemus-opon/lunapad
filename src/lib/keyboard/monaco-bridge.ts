/** Chords Monaco may consume before the capture dispatcher can act — re-dispatch to cell container. */
export function shouldForwardFromMonaco(e: KeyboardEvent, widgetOpen = false): boolean {
	const mod = e.metaKey || e.ctrlKey;
	if (e.key === 'Enter' && (e.shiftKey || mod)) return true;
	if (mod && e.shiftKey && (e.key.toLowerCase() === 'l' || e.key.toLowerCase() === 't')) return true;
	if (mod && e.shiftKey && e.key.toLowerCase() === 'k') return true;
	if (e.key === 'Escape' && !widgetOpen) return true;
	return false;
}

export function shouldForwardFromMarkdownMonaco(e: KeyboardEvent, widgetOpen = false): boolean {
	const mod = e.metaKey || e.ctrlKey;
	if (e.key === 'Enter' && (e.shiftKey || mod)) return true;
	if (e.key === 'Escape' && !widgetOpen) return true;
	return false;
}
