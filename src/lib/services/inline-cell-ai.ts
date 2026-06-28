import type { LLMConfig } from '$lib/stores/notebook.svelte';

export interface InlineCellEditColumn {
	name: string;
	dataKind: 'numeric' | 'date' | 'boolean' | 'text';
	semanticType?: string;
	sqlType?: string;
	sampleValues?: string[];
	nullRatio?: number;
	distinctCount?: number;
}

export interface InlineCellEditInput {
	instruction: string;
	cellType: 'query' | 'python';
	language?: 'prql' | 'sql';
	existingCode: string;
	sourceTable?: string;
	columns?: InlineCellEditColumn[];
	otherTables?: Array<{ name: string; columns: string[]; columnTypes: string[] }>;
	llmConfig: LLMConfig;
	timeoutMs?: number;
}

export interface InlineCellEditSuggestedAlternative {
	cellType: 'query' | 'python';
	language?: 'sql' | 'prql';
	reason: string;
}

export interface InlineCellEditResult {
	code: string;
	cellType: 'query' | 'python';
	language?: 'sql' | 'prql';
	reasoning?: string;
	suggestedAlternative?: InlineCellEditSuggestedAlternative;
}

type SSEEvent =
	| { type: 'status'; message: string }
	| ({ type: 'result' } & InlineCellEditResult)
	| { type: 'error'; error: string };

// ── Simple LRU cache, same shape as prompt-llm.ts's PRQL cache ──

const CACHE_MAX_SIZE = 40;
const _cache = new Map<string, InlineCellEditResult>();

function makeCacheKey(input: InlineCellEditInput): string {
	return `${input.instruction.trim().toLowerCase()}::${input.cellType}::${input.language ?? ''}::${input.existingCode}`;
}

function cacheGet(key: string): InlineCellEditResult | undefined {
	const hit = _cache.get(key);
	if (hit) {
		_cache.delete(key);
		_cache.set(key, hit);
	}
	return hit;
}

function cacheSet(key: string, value: InlineCellEditResult): void {
	if (_cache.size >= CACHE_MAX_SIZE) {
		const oldest = _cache.keys().next().value;
		if (oldest !== undefined) _cache.delete(oldest);
	}
	_cache.set(key, value);
}

let _activeController: AbortController | null = null;

export async function editCellWithAI(
	input: InlineCellEditInput,
	onProgress?: (message: string) => void
): Promise<InlineCellEditResult | null> {
	const cacheKey = makeCacheKey(input);
	const cached = cacheGet(cacheKey);
	if (cached) return cached;

	_activeController?.abort();
	_activeController = new AbortController();
	const signal = _activeController.signal;

	try {
		const response = await fetch('/api/ai/edit-cell', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				instruction: input.instruction,
				cellType: input.cellType,
				language: input.language,
				existingCode: input.existingCode,
				sourceTable: input.sourceTable,
				columns: input.columns ?? [],
				otherTables: input.otherTables,
				llmConfig: input.llmConfig,
				timeoutMs: input.timeoutMs
			}),
			signal
		});

		if (!response.ok) {
			const errorBody = (await response.json()) as { error?: string };
			throw new Error(errorBody.error ?? 'AI cell edit failed.');
		}
		if (!response.body) throw new Error('Response body unavailable');

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split('\n\n');
			buffer = parts.pop() ?? '';
			for (const part of parts) {
				if (!part.startsWith('data: ')) continue;
				const event = JSON.parse(part.slice(6)) as SSEEvent;
				if (event.type === 'status') {
					onProgress?.(event.message);
				} else if (event.type === 'result') {
					const result: InlineCellEditResult = {
						code: event.code,
						cellType: event.cellType,
						language: event.language,
						reasoning: event.reasoning,
						suggestedAlternative: event.suggestedAlternative
					};
					cacheSet(cacheKey, result);
					return result;
				} else if (event.type === 'error') {
					throw new Error(event.error ?? 'AI cell edit failed');
				}
			}
		}

		throw new Error('AI stream ended without a result');
	} finally {
		if (_activeController?.signal === signal) {
			_activeController = null;
		}
	}
}

export function cancelActiveCellEdit(): void {
	_activeController?.abort();
	_activeController = null;
}
