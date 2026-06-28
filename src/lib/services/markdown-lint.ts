// Heuristic check that nudges the AI away from pasting static numbers into
// markdown cells instead of using live refs ($cell.field / {% metric ... %}).
// Imperfect by design — false positives are expected and acceptable since the
// result is surfaced as a soft hint (like validateColumnRefs), not a hard error.

import type { Cell } from '$lib/stores/notebook.svelte';

interface Match {
	start: number;
	end: number;
	text: string;
}

function findMatches(text: string, re: RegExp): Match[] {
	const out: Match[] = [];
	for (const m of text.matchAll(re)) {
		const start = m.index ?? 0;
		out.push({ start, end: start + m[0].length, text: m[0] });
	}
	return out;
}

function isLikelyYear(token: string): boolean {
	if (token.length !== 4) return false;
	const n = Number(token);
	return n >= 1900 && n <= 2099;
}

/** Strips Markdoc tag syntax ({%...%}) — anything inside is intentionally dynamic.
 *  Also strips the old {{...}} ref syntax so numbers left over in pre-migration
 *  notebooks aren't flagged as freshly hardcoded. */
function stripRefs(markdown: string): string {
	return markdown.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\{%[^%]*%\}/g, ' ');
}

export function detectHardcodedValues(markdown: string): string | null {
	const stripped = stripRefs(markdown);

	const claimed: Match[] = [];
	const claim = (matches: Match[]) => {
		for (const m of matches) {
			if (claimed.some((r) => m.start < r.end && m.end > r.start)) continue;
			claimed.push(m);
		}
	};

	claim(findMatches(stripped, /\$\d[\d,]*(?:\.\d+)?/g));
	claim(findMatches(stripped, /\b\d+(?:\.\d+)?%/g));
	claim(findMatches(stripped, /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g));
	claim(findMatches(stripped, /\b\d{4,}\b/g).filter((m) => !isLikelyYear(m.text)));

	if (claimed.length === 0) return null;

	const samples = claimed
		.sort((a, b) => a.start - b.start)
		.map((m) => m.text)
		.slice(0, 5);
	return `found ${samples.map((s) => `"${s}"`).join(', ')} — replace with $cellName.field or {% metric value=$cellName.field /%} so this stays live`;
}

// Generic words that are too common to be useful signal, even when they happen to
// match a string value sitting in some upstream row — flagging these would mostly
// produce noise rather than catch a real hardcoded-from-data violation.
const TEXT_STOPLIST = new Set([
	'yes', 'no', 'ok', 'okay', 'true', 'false', 'null', 'none', 'n/a', 'na',
	'unknown', 'other', 'total', 'all', 'various', 'and', 'or', 'the', 'a', 'is'
]);

const MAX_ROWS_PER_CELL = 200;
const MAX_CANDIDATES = 5000;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Distinct, lint-worthy string values pulled from upstream query-cell rows. */
function collectTextCandidates(cells: Cell[]): string[] {
	const seen = new Map<string, string>(); // lowercase -> original casing (first seen)
	for (const cell of cells) {
		if (cell.cellType !== 'query' || !cell.result) continue;
		for (const row of cell.result.rows.slice(0, MAX_ROWS_PER_CELL)) {
			for (const value of Object.values(row)) {
				if (typeof value !== 'string') continue;
				const trimmed = value.trim();
				if (trimmed.length < 2) continue;
				if (/^[\d.,$%\s-]+$/.test(trimmed)) continue; // numeric-shaped — handled by detectHardcodedValues
				const key = trimmed.toLowerCase();
				if (TEXT_STOPLIST.has(key)) continue;
				if (!seen.has(key)) {
					seen.set(key, trimmed);
					if (seen.size >= MAX_CANDIDATES) break;
				}
			}
			if (seen.size >= MAX_CANDIDATES) break;
		}
		if (seen.size >= MAX_CANDIDATES) break;
	}
	return [...seen.values()];
}

/**
 * Flags literal text in the markdown that matches a real string value from an
 * upstream cell's result rows — e.g. a status or category typed in by hand instead
 * of referenced live. Cross-references actual data rather than guessing by shape,
 * to keep the false-positive rate low.
 */
export function detectHardcodedTextValues(markdown: string, cells: Cell[]): string | null {
	const stripped = stripRefs(markdown);
	const candidates = collectTextCandidates(cells).sort((a, b) => b.length - a.length);

	const claimed: Match[] = [];
	for (const candidate of candidates) {
		const re = new RegExp(`\\b${escapeRegex(candidate)}\\b`, 'gi');
		for (const m of findMatches(stripped, re)) {
			if (claimed.some((r) => m.start < r.end && m.end > r.start)) continue;
			claimed.push(m);
		}
	}

	if (claimed.length === 0) return null;

	const samples = claimed
		.sort((a, b) => a.start - b.start)
		.map((m) => m.text)
		.slice(0, 5);
	return `found text ${samples.map((s) => `"${s}"`).join(', ')} matching real query-result values — replace with $cellName.field so this stays accurate if the data changes`;
}

/** Combined numeric + text hardcoding check — numeric runs first since it's cheaper. */
export function detectHardcodedContent(markdown: string, cells: Cell[]): string | null {
	return detectHardcodedValues(markdown) ?? detectHardcodedTextValues(markdown, cells);
}
