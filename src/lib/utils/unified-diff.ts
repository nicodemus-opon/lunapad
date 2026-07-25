import { parsePatch, structuredPatch, createTwoFilesPatch, type StructuredPatchHunk } from 'diff';

export type DiffRowKind = 'context' | 'added' | 'removed';

export interface DiffRow {
	kind: DiffRowKind;
	oldLine: number | null;
	newLine: number | null;
	text: string;
}

export interface DiffHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	/** Unchanged lines skipped between this hunk and the previous one (0 for the first hunk). */
	linesSkippedBefore: number;
	rows: DiffRow[];
}

export interface ParsedDiff {
	hunks: DiffHunk[];
	isBinary: boolean;
}

const BINARY_MARKER = /^Binary files .* differ/m;

function hunkToDiffHunk(h: StructuredPatchHunk, prevOldEnd: number): DiffHunk {
	let oldLine = h.oldStart;
	let newLine = h.newStart;
	const rows: DiffRow[] = [];
	for (const raw of h.lines) {
		if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
		const marker = raw[0];
		const text = raw.slice(1);
		if (marker === '+') {
			rows.push({ kind: 'added', oldLine: null, newLine, text });
			newLine++;
		} else if (marker === '-') {
			rows.push({ kind: 'removed', oldLine, newLine: null, text });
			oldLine++;
		} else {
			rows.push({ kind: 'context', oldLine, newLine, text });
			oldLine++;
			newLine++;
		}
	}
	return {
		oldStart: h.oldStart,
		oldLines: h.oldLines,
		newStart: h.newStart,
		newLines: h.newLines,
		linesSkippedBefore: prevOldEnd > 0 ? Math.max(0, h.oldStart - prevOldEnd) : 0,
		rows
	};
}

function hunksToDiffHunks(hunks: readonly StructuredPatchHunk[]): DiffHunk[] {
	const result: DiffHunk[] = [];
	let prevOldEnd = 0;
	for (const h of hunks) {
		result.push(hunkToDiffHunk(h, prevOldEnd));
		prevOldEnd = h.oldStart + h.oldLines;
	}
	return result;
}

/** Parses a raw unified-diff string (as produced by `git diff`) into a structured,
 *  line-numbered model. Handles multi-hunk single-file patches and the synthesized
 *  whole-file diff git produces for untracked files. */
export function parseUnifiedDiff(diffText: string): ParsedDiff {
	const trimmed = diffText.trim();
	if (!trimmed) return { hunks: [], isBinary: false };
	if (BINARY_MARKER.test(trimmed)) return { hunks: [], isBinary: true };

	const files = parsePatch(diffText);
	const hunks = files.flatMap((f) => hunksToDiffHunks(f.hunks));
	return { hunks, isBinary: false };
}

/** Diffs two full-text strings directly (no `git diff` round-trip) — used for
 *  live editor gutters where the comparison is against an in-memory buffer. */
export function diffTexts(oldText: string, newText: string, contextLines = 3): ParsedDiff {
	if (oldText === newText) return { hunks: [], isBinary: false };
	const patch = structuredPatch('a', 'b', oldText, newText, undefined, undefined, {
		context: contextLines
	});
	return { hunks: hunksToDiffHunks(patch.hunks), isBinary: false };
}

/** Same two-full-text diff as `diffTexts`, but rendered as a raw unified-diff
 *  string — for callers (like a three-way conflict view) that want to hand
 *  the result to `UnifiedDiffView`, which parses that format directly. */
export function diffTextsAsUnifiedString(
	oldText: string,
	newText: string,
	oldLabel = 'a',
	newLabel = 'b'
): string {
	if (oldText === newText) return '';
	return createTwoFilesPatch(oldLabel, newLabel, oldText, newText);
}
