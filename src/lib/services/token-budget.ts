// Shared token-budgeting utilities. Replaces the ad-hoc `.slice(0, N)` item/char-count caps
// scattered across the AI context-building code with one measured cutoff. Uses cl100k_base as
// a cross-model approximation — we don't know the exact tokenizer of whatever OpenAI-compatible
// endpoint (Ollama, vLLM, a hosted provider, ...) the user has configured, and an approximate
// count is enough to keep prompts within a safe margin of the configured model's context window.

import { countTokens } from 'gpt-tokenizer/esm/encoding/cl100k_base';

export const DEFAULT_SCHEMA_TOKEN_BUDGET = 6_000;
export const DEFAULT_HISTORY_TOKEN_BUDGET = 7_000;
export const SMALL_MODEL_SCHEMA_TOKEN_BUDGET = 2_500;

export function estimateTokens(text: string): number {
	if (!text) return 0;
	return countTokens(text);
}

/**
 * Greedily keeps items (in the order given — callers must pre-sort by relevance) until adding
 * the next one would exceed `budgetTokens`. Does not reorder or re-rank; it only enforces the
 * budget on top of whatever priority order the caller already established.
 */
export function fitToTokenBudget<T>(
	items: T[],
	budgetTokens: number,
	tokensFor: (item: T) => number
): { kept: T[]; dropped: T[] } {
	const kept: T[] = [];
	const dropped: T[] = [];
	let used = 0;
	for (const item of items) {
		const cost = tokensFor(item);
		if (used + cost <= budgetTokens) {
			kept.push(item);
			used += cost;
		} else {
			dropped.push(item);
		}
	}
	return { kept, dropped };
}
