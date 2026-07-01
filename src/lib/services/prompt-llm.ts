import type { GUIPipelineStage } from '$lib/types/gui-pipeline';
import type { ExternalPromptStageSuggestionInput } from '$lib/services/stage-catalog';
import type { LLMPlanningContext } from '$lib/services/intelligence-db';

export interface PromptLLMConfig {
	provider: 'openapi-compatible' | 'ollama';
	baseUrl: string;
	model: string;
	apiKey?: string;
}

interface PromptLLMInferenceRequest {
	query: string;
	availableColumns: string[];
	llmContext?: LLMPlanningContext;
	llmConfig: PromptLLMConfig;
	timeoutMs?: number;
}

interface PromptLLMInferenceResponse {
	suggestion?: ExternalPromptStageSuggestionInput;
	error?: string;
}

function isPipelineStageArray(
	value: unknown
): value is Exclude<GUIPipelineStage, { type: 'raw' }>[] {
	if (!Array.isArray(value)) return false;
	return value.every(
		(stage) =>
			typeof stage === 'object' &&
			stage !== null &&
			typeof (stage as { type?: unknown }).type === 'string'
	);
}

export async function inferPromptStageSuggestionWithLLM(
	input: PromptLLMInferenceRequest
): Promise<ExternalPromptStageSuggestionInput | null> {
	const response = await fetch('/api/llm/prompt-stage-plan', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});

	const body = (await response.json()) as PromptLLMInferenceResponse;
	if (!response.ok) {
		throw new Error(body.error ?? 'LLM prompt-stage inference failed.');
	}

	const suggestion = body.suggestion;
	if (!suggestion || !isPipelineStageArray(suggestion.stages)) return null;
	if (typeof suggestion.label !== 'string' || suggestion.label.trim().length === 0) return null;

	return {
		label: suggestion.label,
		prompt:
			typeof suggestion.prompt === 'string'
				? suggestion.prompt
				: `${suggestion.label}: generated from prompt inference`,
		reasons: Array.isArray(suggestion.reasons)
			? suggestion.reasons
					.filter(
						(reason): reason is string => typeof reason === 'string' && reason.trim().length > 0
					)
					.slice(0, 5)
			: ['LLM-inferred stage chain'],
		stages: suggestion.stages,
		score: typeof suggestion.score === 'number' ? suggestion.score : 130,
		confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : 0.74
	};
}

// ── Full PRQL generation (complex queries with windows / joins / derived analytics) ──

export interface FullPRQLGenerationInput {
	query: string;
	sourceTable: string;
	columns: Array<{
		name: string;
		dataKind: 'numeric' | 'date' | 'boolean' | 'text';
		semanticType?: string;
		sqlType?: string;
		sampleValues?: string[];
		nullRatio?: number;
		distinctCount?: number;
	}>;
	otherTables?: Array<{
		name: string;
		columns: string[];
		columnTypes: string[];
	}>;
	llmConfig: PromptLLMConfig;
	timeoutMs?: number;
}

export interface FullPRQLGenerationResult {
	prql: string;
	reasoning?: string;
}

type SSEEvent =
	| { type: 'status'; message: string }
	| { type: 'result'; prql: string; reasoning?: string }
	| { type: 'error'; error: string };

// ── Simple LRU cache for generate-prql responses ──

const CACHE_MAX_SIZE = 40;

const _prqlCache = new Map<string, FullPRQLGenerationResult>();

function makeCacheKey(input: FullPRQLGenerationInput): string {
	const colKey = input.columns.map((c) => `${c.name}:${c.dataKind}`).join('|');
	return `${input.query.trim().toLowerCase()}::${input.sourceTable}::${colKey}`;
}

function cacheGet(key: string): FullPRQLGenerationResult | undefined {
	const hit = _prqlCache.get(key);
	if (hit) {
		_prqlCache.delete(key);
		_prqlCache.set(key, hit);
	}
	return hit;
}

function cacheSet(key: string, value: FullPRQLGenerationResult): void {
	if (_prqlCache.size >= CACHE_MAX_SIZE) {
		const oldest = _prqlCache.keys().next().value;
		if (oldest !== undefined) _prqlCache.delete(oldest);
	}
	_prqlCache.set(key, value);
}

// ── In-flight request cancellation ──

let _activeGenerateController: AbortController | null = null;

export async function generateFullPRQLWithLLM(
	input: FullPRQLGenerationInput,
	onProgress?: (message: string) => void
): Promise<FullPRQLGenerationResult | null> {
	const cacheKey = makeCacheKey(input);
	const cached = cacheGet(cacheKey);
	if (cached) return cached;

	_activeGenerateController?.abort();
	_activeGenerateController = new AbortController();
	const signal = _activeGenerateController.signal;

	try {
		const response = await fetch('/api/llm/generate-prql', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: input.query,
				sourceTable: input.sourceTable,
				columns: input.columns,
				otherTables: input.otherTables,
				llmConfig: input.llmConfig,
				timeoutMs: input.timeoutMs
			}),
			signal
		});

		if (!response.ok) {
			// Validation errors (400) come back as JSON, not SSE
			const errorBody = (await response.json()) as { error?: string };
			throw new Error(errorBody.error ?? 'LLM full PRQL generation failed.');
		}

		if (!response.body) {
			throw new Error('Response body unavailable');
		}

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
				} else if (event.type === 'result' && event.prql) {
					const result: FullPRQLGenerationResult = { prql: event.prql, reasoning: event.reasoning };
					cacheSet(cacheKey, result);
					return result;
				} else if (event.type === 'error') {
					throw new Error(event.error ?? 'LLM generation failed');
				}
			}
		}

		throw new Error('LLM stream ended without a result');
	} finally {
		if (_activeGenerateController?.signal === signal) {
			_activeGenerateController = null;
		}
	}
}

/** Cancel any in-flight generateFullPRQLWithLLM request. */
export function cancelActiveGenerate(): void {
	_activeGenerateController?.abort();
	_activeGenerateController = null;
}
