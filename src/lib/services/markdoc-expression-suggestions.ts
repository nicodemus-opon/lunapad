import type { Cell } from '$lib/stores/notebook.svelte';
import { buildMarkdocVariables } from '$lib/services/markdoc-interp';
import { MARKDOC_FUNCTIONS } from '$lib/services/markdoc-catalog';

export interface ExpressionSuggestion {
	/** Text inserted in place of the active token. */
	insert: string;
	/** Display label. */
	label: string;
	/** Secondary hint (signature / type). */
	detail: string;
	kind: 'ref' | 'function';
}

/** The token being typed at `cursor` — a `$ref.path` or bare identifier run. */
export function activeExpressionToken(
	value: string,
	cursor: number
): { token: string; start: number } {
	let start = cursor;
	while (start > 0 && /[$A-Za-z0-9_.]/.test(value[start - 1])) start--;
	return { token: value.slice(start, cursor), start };
}

/** Build ref suggestions ($cell, $cell.column) from live cells plus the pseudo-fields. */
function refSuggestions(cells: Cell[]): ExpressionSuggestion[] {
	const bag = buildMarkdocVariables(cells);
	const out: ExpressionSuggestion[] = [];
	for (const [name, value] of Object.entries(bag)) {
		out.push({ insert: `$${name}`, label: `$${name}`, detail: 'cell', kind: 'ref' });
		if (value && typeof value === 'object') {
			for (const field of Object.keys(value as Record<string, unknown>)) {
				out.push({
					insert: `$${name}.${field}`,
					label: `$${name}.${field}`,
					detail: field === 'rows' ? 'rows' : 'field',
					kind: 'ref'
				});
			}
		}
	}
	return out;
}

function functionSuggestions(): ExpressionSuggestion[] {
	return Object.entries(MARKDOC_FUNCTIONS).map(([name, entry]) => ({
		insert: `${name}(`,
		label: entry.signature,
		detail: entry.detail,
		kind: 'function' as const
	}));
}

/** Suggestions for the active token, ranked (prefix matches first), capped. */
export function expressionSuggestions(
	value: string,
	cursor: number,
	cells: Cell[],
	limit = 8
): ExpressionSuggestion[] {
	const { token } = activeExpressionToken(value, cursor);
	if (!token) return [];
	const q = token.toLowerCase();
	const pool = token.startsWith('$')
		? refSuggestions(cells)
		: [...functionSuggestions(), ...refSuggestions(cells)];
	const scored = pool
		.map((s) => {
			const hay = s.label.toLowerCase();
			const insert = s.insert.toLowerCase();
			let score = -1;
			if (insert.startsWith(q) || hay.startsWith(q)) score = 0;
			else if (hay.includes(q)) score = 1;
			return { s, score };
		})
		.filter((x) => x.score >= 0)
		.sort((a, b) => a.score - b.score);
	return scored.slice(0, limit).map((x) => x.s);
}
