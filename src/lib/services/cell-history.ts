/**
 * Metabase-style per-cell version history.
 *
 * Metabase's Info > History tab cuts an automatic version on every save
 * (capped at 15 per entity) and renders semantic labels — "modified the
 * query", "changed the visualization settings" — with relative timestamps
 * and one-click revert. No branches, no staging area, no commit messages.
 *
 * This module is the Lunapad equivalent for notebook cells (query cell ≈
 * Metabase question/model, `resultChartConfig`/`plotConfig` ≈ visualization
 * settings). It is deliberately decoupled from the repo-level git UI
 * (`GitPanel.svelte`): revisions are content snapshots persisted to
 * localStorage, so history works in `local` storage mode with no git repo.
 */

export const MAX_CELL_REVISIONS = 15;

export type CellChangeKind =
	| 'create'
	| 'query'
	| 'visualization'
	| 'metadata'
	| 'text'
	| 'revert'
	| 'move';

/** Minimal structural view of a Cell — only the fields history cares about.
 *  Uses `unknown` for config blobs so this module never imports the store
 *  (which would create an import cycle: store -> services -> store). */
export interface CellLike {
	id: string;
	cellType: string;
	outputName: string;
	code: string;
	markdown: string;
	udfBody: string;
	language: string;
	connectionId: string | null;
	guiStages: unknown;
	editMode: string;
	materializeMode: string;
	description: string | null;
	dbtTags: string[];
	resultChartConfig: unknown;
	plotConfig: unknown;
	plotMode: unknown;
}

export interface CellHistorySnapshot {
	outputName: string;
	cellType: string;
	language: string;
	code: string;
	markdown: string;
	udfBody: string;
	connectionId: string | null;
	guiStages: unknown;
	editMode: string;
	materializeMode: string;
	description: string | null;
	dbtTags: string[];
	resultChartConfig: unknown;
	plotConfig: unknown;
	plotMode: unknown;
}

export interface CellRevision {
	id: string;
	notebookId: string;
	cellId: string;
	outputName: string;
	ts: number;
	actor: string;
	kind: CellChangeKind;
	label: string;
	snapshot: CellHistorySnapshot;
}

export function snapshotFromCell(cell: CellLike): CellHistorySnapshot {
	return {
		outputName: cell.outputName,
		cellType: cell.cellType,
		language: cell.language,
		code: cell.code,
		markdown: cell.markdown,
		udfBody: cell.udfBody,
		connectionId: cell.connectionId,
		guiStages: structuredCloneSafe(cell.guiStages),
		editMode: cell.editMode,
		materializeMode: cell.materializeMode,
		description: cell.description,
		dbtTags: [...cell.dbtTags],
		resultChartConfig: structuredCloneSafe(cell.resultChartConfig),
		plotConfig: structuredCloneSafe(cell.plotConfig),
		plotMode: cell.plotMode
	};
}

function structuredCloneSafe<T>(value: T): T {
	try {
		if (typeof structuredClone === 'function') return structuredClone(value);
	} catch {
		/* fall through to JSON */
	}
	try {
		return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
	} catch {
		return value;
	}
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

/**
 * Classify what changed between two snapshots. Query wins over visualization
 * (one row per save, like Metabase). Returns null when nothing meaningful
 * changed (e.g. autosave with identical content).
 */
export function classifyCellChange(
	prev: CellHistorySnapshot,
	next: CellHistorySnapshot
): CellChangeKind | null {
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

/** Metabase copy: "You modified the query." / "You changed the visualization settings." */
export function labelForKind(kind: CellChangeKind): string {
	switch (kind) {
		case 'create':
			return 'created this cell';
		case 'query':
			return 'modified the query';
		case 'visualization':
			return 'changed the visualization settings';
		case 'metadata':
			return 'edited details';
		case 'text':
			return 'edited text';
		case 'revert':
			return 'reverted to an earlier version';
		case 'move':
			return 'moved this cell';
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

// ── Persistence (localStorage, capped at MAX_CELL_REVISIONS) ────────────────

const STORAGE_KEY = 'lunapad:cell-history:v1';

type RevisionMap = Record<string, CellRevision[]>;

function storageKey(notebookId: string, cellId: string): string {
	return `${notebookId}:${cellId}`;
}

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
function sortNewestFirst(list: CellRevision[]): CellRevision[] {
	return list
		.map((rev, index) => ({ rev, index }))
		.sort((a, b) => b.rev.ts - a.rev.ts || b.index - a.index)
		.map(({ rev }) => rev);
}

export function getCellRevisions(notebookId: string, cellId: string): CellRevision[] {
	const all = readAll();
	return sortNewestFirst(all[storageKey(notebookId, cellId)] ?? []);
}

function pushRevision(rev: CellRevision): CellRevision[] {
	const all = readAll();
	const key = storageKey(rev.notebookId, rev.cellId);
	// Stored oldest-first so the cap drops the oldest; readers sort newest-first.
	const list = [...(all[key] ?? []), rev].slice(-MAX_CELL_REVISIONS);
	all[key] = list;
	writeAll(all);
	return sortNewestFirst(list);
}

/**
 * Compare `cell` against the latest recorded revision and cut a new one when
 * something meaningful changed. Seeds a `create` revision on first sight.
 * Returns the new revision, or null when nothing changed.
 */
export function maybeRecordCellRevision(
	notebookId: string,
	cell: CellLike,
	actor = 'You',
	now = Date.now()
): CellRevision | null {
	const snapshot = snapshotFromCell(cell);
	const key = storageKey(notebookId, cell.id);
	const all = readAll();
	const list = all[key] ?? [];
	const prev = list.length > 0 ? list[list.length - 1] : null;

	if (!prev) {
		const rev: CellRevision = {
			id: makeId(),
			notebookId,
			cellId: cell.id,
			outputName: cell.outputName,
			ts: now,
			actor,
			kind: 'create',
			label: labelForKind('create'),
			snapshot
		};
		pushRevision(rev);
		return rev;
	}

	const kind = classifyCellChange(prev.snapshot, snapshot);
	if (!kind) return null;
	const rev: CellRevision = {
		id: makeId(),
		notebookId,
		cellId: cell.id,
		outputName: cell.outputName,
		ts: now,
		actor,
		kind,
		label: labelForKind(kind),
		snapshot
	};
	pushRevision(rev);
	return rev;
}

/** Cut an explicit `revert` revision after restoring `snapshot`. */
export function recordRevertRevision(
	notebookId: string,
	cell: CellLike,
	snapshot: CellHistorySnapshot,
	actor = 'You',
	now = Date.now()
): CellRevision {
	const rev: CellRevision = {
		id: makeId(),
		notebookId,
		cellId: cell.id,
		outputName: snapshot.outputName,
		ts: now,
		actor,
		kind: 'revert',
		label: labelForKind('revert'),
		snapshot: structuredCloneSafe(snapshot)
	};
	pushRevision(rev);
	return rev;
}

/** Rename-aware cleanup: drop history for a deleted cell to bound storage. */
export function clearCellHistory(notebookId: string, cellId: string): void {
	const all = readAll();
	const key = storageKey(notebookId, cellId);
	if (key in all) {
		delete all[key];
		writeAll(all);
	}
}
