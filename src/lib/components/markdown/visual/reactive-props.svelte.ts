/**
 * Create a deeply-reactive props object for Svelte components mounted
 * imperatively (e.g. inside ProseMirror node views). Mutating the returned
 * proxy updates the mounted component in place — no unmount/remount needed.
 *
 * Node views MUST use this instead of remounting on every update/select:
 * remounting destroys embedded editors (Monaco), open dropdowns, and focus,
 * which makes cells impossible to type in.
 */
export function reactiveProps<T extends Record<string, unknown>>(initial: T): T {
	const props = $state(initial);
	return props;
}
