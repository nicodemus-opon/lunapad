/** DataGrip-style identifier matching with layered scoring. */

export type MatchKind = 'exact' | 'prefix' | 'token' | 'initials' | 'subsequence' | 'none';

export interface MatchResult {
	kind: MatchKind;
	score: number;
}

const KIND_SCORE: Record<MatchKind, number> = {
	exact: 100,
	prefix: 50,
	token: 35,
	initials: 30,
	subsequence: 10,
	none: 0
};

function splitTokens(label: string): string[] {
	return label
		.replace(/([a-z])([A-Z])/g, '$1_$2')
		.toLowerCase()
		.split(/[_\-.]+/)
		.filter(Boolean);
}

function camelCaseInitials(label: string): string {
	const tokens = splitTokens(label);
	if (tokens.length > 1) return tokens.map((t) => t[0] ?? '').join('');
	return label
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.split(/\s+/)
		.map((w) => w[0] ?? '')
		.join('')
		.toLowerCase();
}

function subsequenceMatch(label: string, prefix: string): boolean {
	const l = label.toLowerCase();
	const p = prefix.toLowerCase();
	let li = 0;
	for (let pi = 0; pi < p.length; pi++) {
		const idx = l.indexOf(p[pi]!, li);
		if (idx < 0) return false;
		li = idx + 1;
	}
	return true;
}

/** Score how well `prefix` matches `label`. Higher is better; 0 = no match. */
export function scoreMatch(label: string, prefix: string): MatchResult {
	if (!prefix) return { kind: 'prefix', score: KIND_SCORE.prefix };

	const labelLower = label.toLowerCase();
	const prefixLower = prefix.toLowerCase();

	if (labelLower === prefixLower) return { kind: 'exact', score: KIND_SCORE.exact };
	if (labelLower.startsWith(prefixLower)) return { kind: 'prefix', score: KIND_SCORE.prefix };

	// Underscore token prefix: `ord_am` → `order_amount`
	const tokens = splitTokens(label);
	const prefixTokens = splitTokens(prefix.replace(/_/g, ' '));
	if (prefixTokens.length > 0) {
		const joined = tokens.join('_');
		if (joined.startsWith(prefixLower.replace(/\s+/g, '_'))) {
			return { kind: 'token', score: KIND_SCORE.token };
		}
		for (const token of tokens) {
			if (token.startsWith(prefixLower)) return { kind: 'token', score: KIND_SCORE.token };
		}
	}

	// camelCase initials: `oId` → `orderId`
	const initials = camelCaseInitials(label);
	if (initials.startsWith(prefixLower)) return { kind: 'initials', score: KIND_SCORE.initials };

	if (prefix.length >= 2 && subsequenceMatch(label, prefix)) {
		return { kind: 'subsequence', score: KIND_SCORE.subsequence };
	}

	return { kind: 'none', score: 0 };
}

/** Whether prefix matches label at all (any match kind except none). */
export function prefixMatches(label: string, prefix: string): boolean {
	return scoreMatch(label, prefix).kind !== 'none';
}
