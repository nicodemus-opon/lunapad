import type { KeyChord, ShortcutContext, ShortcutDef } from './types';

export function eventToChord(e: KeyboardEvent): KeyChord {
	return {
		key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
		mod: e.metaKey || e.ctrlKey,
		shift: e.shiftKey,
		alt: e.altKey
	};
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
	return (
		a.key === b.key &&
		Boolean(a.mod) === Boolean(b.mod) &&
		Boolean(a.shift) === Boolean(b.shift) &&
		Boolean(a.alt) === Boolean(b.alt) &&
		Boolean(a.plain) === Boolean(b.plain)
	);
}

export function chordMatchesEvent(def: KeyChord, e: KeyboardEvent): boolean {
	const mod = e.metaKey || e.ctrlKey;
	if (def.plain && (mod || e.altKey)) return false;
	if (Boolean(def.mod) !== mod) return false;
	if (Boolean(def.shift) !== e.shiftKey) return false;
	if (Boolean(def.alt) !== e.altKey) return false;

	const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if (def.key === eventKey) return true;
	// Allow ArrowUp/ArrowDown aliases
	if (def.key === 'ArrowUp' && e.key === 'ArrowUp') return true;
	if (def.key === 'ArrowDown' && e.key === 'ArrowDown') return true;
	return false;
}

export function contextMatches(def: ShortcutDef, ctx: ShortcutContext): boolean {
	return def.contexts.some((c) => ctx.contexts.includes(c));
}

export function findMatchingShortcut(
	shortcuts: ShortcutDef[],
	e: KeyboardEvent,
	ctx: ShortcutContext
): ShortcutDef | null {
	const matches = shortcuts.filter(
		(s) => chordMatchesEvent(s.chord, e) && contextMatches(s, ctx) && (!s.when || s.when(ctx))
	);
	if (matches.length === 0) return null;
	matches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
	return matches[0] ?? null;
}
