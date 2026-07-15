/**
 * Vanilla ProseMirror NodeViews (container/widget extensions) only re-run their
 * `update()` hook when the node's own attrs/content change — never when external
 * reactive state (a query cell's `.result`) changes elsewhere in the store. This
 * bus lets an editor's `$effect` (which *does* see cell updates) tell every
 * currently-mounted NodeView to re-pull `getCells()` and re-derive its chrome
 * (each/group loop preview, orphaned-filter badges, live metric/chart data).
 */
export interface RefreshBus {
	register(fn: () => void): () => void;
	notify(): void;
}

export function createRefreshBus(): RefreshBus {
	const listeners = new Set<() => void>();
	return {
		register(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		notify() {
			for (const fn of listeners) fn();
		}
	};
}
