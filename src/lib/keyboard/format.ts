import type { KeyChord } from './types';

const isMac =
	typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function formatChord(chord: KeyChord): string {
	const parts: string[] = [];
	if (chord.mod) parts.push(isMac ? '⌘' : 'Ctrl+');
	if (chord.shift) parts.push(isMac ? '⇧' : 'Shift+');
	if (chord.alt) parts.push(isMac ? '⌥' : 'Alt+');

	const key = formatKey(chord.key);
	if (isMac) return parts.join('') + key;
	return parts.join('') + key;
}

function formatKey(key: string): string {
	switch (key) {
		case 'Enter':
			return '↵';
		case 'ArrowUp':
			return '↑';
		case 'ArrowDown':
			return '↓';
		case 'Escape':
			return 'Esc';
		case 'Backspace':
			return 'Del';
		case 'Delete':
			return 'Del';
		default:
			return key.length === 1 ? key.toUpperCase() : key;
	}
}
