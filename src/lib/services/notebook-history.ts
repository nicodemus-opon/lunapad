/**
 * Metabase-style notebook version history.
 *
 * Metabase's Info > History tab cuts an automatic version of an entity on
 * every save (capped at 15), renders one semantic summary row per version —
 * "modified the query", "changed the visualization settings" — with relative
 * timestamps, and reverts with one click. No branches, no staging area.
 *
 * Here the versioned entity is the whole notebook (Metabase dashboard
 * equivalent): one debounced revision per notebook capturing name + cells, so
 * both editors (classic `NotebookCell` and visual `QueryBlockNodeView`, which
 * mutate the same store) are covered by a single watcher. Revisions persist
 * to localStorage, so history works with no git repo and in `local` mode.
 */

import type { Cell } from '$lib/stores/notebook.svelte';

export const MAX_NOTEBOOK_REVISIONS = 15;

/** A cell as stored in a notebook revision: full content + chrome, without
 *  heavy/ephemeral runtime (results, outputs, diagnostics are re-derived). */
export type NotebookHistoryCell = Omit<
	Cell,
	| 'result'
	| 'pythonOutput'
	| 'errors'
	| 'compiledSQL'
	| 'executionMs'
	| 'needsRun'
	| 'staleReason'
	| 'staleSources'
	| 'lastRunAt'
>;

export interface NotebookHistorySnapshot {
	name: string;
	cells: NotebookHistoryCell[];
}

export type NotebookChangeKind =
	| 'create'
	| 'query'
	| 'visualization'
	| 'text'
	| 'cell-add'
	| 'cell-remove'
	| 'reorder'
	| 'metadata'
	| 'rename'
	| 'revert';

export interface NotebookChange {
	kind: NotebookChangeKind;
	/** Display name of the primarily-affected cell, if any. */
	cellName?: string;
}

export interface NotebookRevision {
	id: string;
	notebookId: string;
	ts: number;
	actor: string;
	kind: NotebookChangeKind;
	label: string;
	snapshot: NotebookHistorySnapshot;
}

const RUNTIME_KEYS = new Set([
	'result',
	'pythonOutput',
	'errors',
	'compiledSQL',
	'executionMs',
	'needsRun',
	'staleReason',
	'staleSources',
	'lastRunAt'
]);

export function snapshotNotebook(name: string, cells: Cell[]): NotebookHistorySnapshot {
	return {
		name,
		cells: cells.map((cell) => {
			const clone = structuredCloneSafe(cell) as unknown as Record<string, unknown>;
			for (const key of RUNTIME_KEYS) delete clone[key];
			return clone as unknown as NotebookHistoryCell;
		})
	};
}

function structuredCloneSafe<T>(value: T): T {
	try {
		if (typeof structuredClone === 'function') return structuredClone(value);
	} catch {
		/* fall through to JSON */
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

/** Per-cell content classification — query wins over visualization, like Metabase's one-row-per-save. */
function classifyCellContent(
	prev: NotebookHistoryCell,
	next: NotebookHistoryCell
): 'query' | 'visualization' | 'text' | 'metadata' | null {
	const queryChanged =
		prev.code !== next.code ||
		prev.language !== next.language ||
		prev.udfBody !== next.udfBody ||
		!jsonEqual(prev.guiStages, next.guiStages) ||
		prev.editMode !== next.editMode;
	if (queryChanged) return 'query';

	const vizChanged =
		!jsonEqual(prev.resultChartConfig, next.resultChartConfig) ||
		!jsonEqual(prev.plotConfig, next.plotConfig) ||
		prev.plotMode !== next.plotMode;
	if (vizChanged) return 'visualization';

	if (prev.markdown !== next.markdown) return 'text';

	const metaChanged =
		prev.outputName !== next.outputName ||
		prev.connectionId !== next.connectionId ||
		prev.materializeMode !== next.materializeMode ||
		prev.description !== next.description ||
		!jsonEqual(prev.dbtTags, next.dbtTags) ||
		prev.cellType !== next.cellType;
	if (metaChanged) return 'metadata';

	return null;
}

export function displayCellName(cell: { outputName: string }): string {
	return cell.outputName || 'untitled cell';
}

/**
 * Diff two notebook snapshots. Structural changes (remove/add/reorder/rename)
 * outrank content edits; the first content edit in cell order wins the label.
 * Returns null when nothing meaningful changed.
 */
export function classifyNotebookChange(
	prev: NotebookHistorySnapshot,
	next: NotebookHistorySnapshot
): NotebookChange | null {
	const prevById = new Map(prev.cells.map((c) => [c.id, c]));
	const nextById = new Map(next.cells.map((c) => [c.id, c]));

	for (const cell of prev.cells) {
		if (!nextById.has(cell.id)) {
			return { kind: 'cell-remove', cellName: displayCellName(cell) };
		}
	}
	for (const cell of next.cells) {
		if (!prevById.has(cell.id)) {
			return { kind: 'cell-add', cellName: displayCellName(cell) };
		}
	}
	if (
		prev.cells.length === next.cells.length &&
		!prev.cells.every((c, i) => next.cells[i].id === c.id)
	) {
		return { kind: 'reorder' };
	}
	if (prev.name !== next.name) return { kind: 'rename' };

	for (const cell of next.cells) {
		const before = prevById.get(cell.id)!;
		const kind = classifyCellContent(before, cell);
		if (kind) return { kind, cellName: displayCellName(cell) };
	}
	return null;
}

/** Single-summary Metabase copy: "modified the orders query." */
export function labelForNotebookChange(change: NotebookChange): string {
	switch (change.kind) {
		case 'create':
			return 'created this notebook';
		case 'query':
			return `modified the ${change.cellName} query`;
		case 'visualization':
			return `changed visualization settings in ${change.cellName}`;
		case 'text':
			return `edited text in ${change.cellName}`;
		case 'cell-add':
			return `added ${change.cellName}`;
		case 'cell-remove':
			return `removed ${change.cellName}`;
		case 'reorder':
			return 'reordered cells';
		case 'metadata':
			return `edited ${change.cellName} details`;
		case 'rename':
			return 'renamed this notebook';
		case 'revert':
			return 'reverted to an earlier version';
	}
}

/** "just now" / "5 minutes ago" / "2 days ago" / "2 months ago" — Metabase style. */
export function relativeTime(ts: number, now = Date.now()): string {
	const diffMs = Math.max(0, now - ts);
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
	const years = Math.floor(months / 12);
	return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Cheap change fingerprint over exactly the fields `classifyNotebookChange`
 * compares — no cloning, never touches heavy runtime like result rows. A
 * watcher reads this inside a reactive effect to subscribe to content edits.
 */
export function fingerprintNotebook(name: string, cells: Cell[]): string {
	return JSON.stringify({
		name,
		cells: cells.map((c) => [
			c.id,
			c.outputName,
			c.cellType,
			c.language,
			c.code,
			c.markdown,
			c.udfBody,
			c.connectionId,
			c.editMode,
			c.materializeMode,
			c.description,
			c.plotMode,
			JSON.stringify(c.guiStages),
			JSON.stringify(c.dbtTags),
			JSON.stringify(c.resultChartConfig),
			JSON.stringify(c.plotConfig)
		])
	});
}

// ── Persistence (localStorage, capped at MAX_NOTEBOOK_REVISIONS) ────────────

const STORAGE_KEY = 'lunapad:notebook-history:v1';

type RevisionMap = Record<string, NotebookRevision[]>;

function readAll(): RevisionMap {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as RevisionMap;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function writeAll(map: RevisionMap): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		/* quota full — history is best-effort, never break the app */
	}
}

function makeId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Newest-first. Ties (same ms) break toward later insertions. */
function sortNewestFirst(list: NotebookRevision[]): NotebookRevision[] {
	return list
		.map((rev, index) => ({ rev, index }))
		.sort((a, b) => b.rev.ts - a.rev.ts || b.index - a.index)
		.map(({ rev }) => rev);
}

export function getNotebookRevisions(notebookId: string): NotebookRevision[] {
	return sortNewestFirst(readAll()[notebookId] ?? []);
}

function pushRevision(rev: NotebookRevision): NotebookRevision[] {
	const all = readAll();
	// Stored oldest-first so the cap drops the oldest; readers sort newest-first.
	const list = [...(all[rev.notebookId] ?? []), rev].slice(-MAX_NOTEBOOK_REVISIONS);
	all[rev.notebookId] = list;
	writeAll(all);
	return sortNewestFirst(list);
}

function toRevision(
	notebookId: string,
	change: NotebookChange,
	snapshot: NotebookHistorySnapshot,
	actor: string,
	now: number
): NotebookRevision {
	return {
		id: makeId(),
		notebookId,
		ts: now,
		actor,
		kind: change.kind,
		label: labelForNotebookChange(change),
		snapshot
	};
}

/**
 * Compare the notebook against its latest recorded revision and cut a new one
 * when something meaningful changed. Seeds a `create` revision on first sight.
 * Returns the new revision, or null when nothing changed.
 */
export function maybeRecordNotebookRevision(
	notebookId: string,
	name: string,
	cells: Cell[],
	actor = 'You',
	now = Date.now()
): NotebookRevision | null {
	const snapshot = snapshotNotebook(name, cells);
	const all = readAll();
	const list = all[notebookId] ?? [];
	const prev = list.length > 0 ? list[list.length - 1] : null;

	if (!prev) {
		const rev = toRevision(notebookId, { kind: 'create' }, snapshot, actor, now);
		pushRevision(rev);
		return rev;
	}
	const change = classifyNotebookChange(prev.snapshot, snapshot);
	if (!change) return null;
	const rev = toRevision(notebookId, change, snapshot, actor, now);
	pushRevision(rev);
	return rev;
}

/** Cut an explicit `revert` revision after restoring `snapshot`. */
export function recordNotebookRevert(
	notebookId: string,
	snapshot: NotebookHistorySnapshot,
	actor = 'You',
	now = Date.now()
): NotebookRevision {
	const rev = toRevision(notebookId, { kind: 'revert' }, structuredCloneSafe(snapshot), actor, now);
	pushRevision(rev);
	return rev;
}

/** Drop history for a deleted notebook to bound storage. */
export function clearNotebookHistory(notebookId: string): void {
	const all = readAll();
	if (notebookId in all) {
		delete all[notebookId];
		writeAll(all);
	}
}
