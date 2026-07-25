import {
	getNotebooks,
	getRelativeCellPath,
	getProjectFolder,
	type Cell
} from '$lib/stores/notebook.svelte';
import { gitFileContentAtRef } from '$lib/services/git-client';
import { diffTexts, type ParsedDiff } from '$lib/utils/unified-diff';

/** Diffs a flat-format cell's live editor buffer against its committed (HEAD)
 *  content, for editor gutter decorations. `.luna`-format notebooks (one file,
 *  many cells) are out of scope for v1 — mapping a hunk's line range back to
 *  a specific cell within the shared file needs its own line-attribution
 *  logic, deferred as a fast-follow. Returns null when there's nothing
 *  meaningful to diff against (no project open, `.luna` notebook, or the
 *  file has no committed version yet). */
export async function getCellDiff(
	notebookId: string,
	cell: Cell,
	liveCode: string
): Promise<ParsedDiff | null> {
	const folder = getProjectFolder();
	if (!folder) return null;
	const notebook = getNotebooks().find((n) => n.id === notebookId);
	if (!notebook || notebook.format === 'luna') return null;
	const relPath = getRelativeCellPath(notebook, cell);
	if (!relPath) return null;
	const oldContent = await gitFileContentAtRef(folder, relPath, 'HEAD');
	if (oldContent === null) return null;
	return diffTexts(oldContent, liveCode);
}
