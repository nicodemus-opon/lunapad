import type { LLMConfig } from '$lib/stores/notebook.svelte';
import {
	executeInvestigationTool,
	trialRunCandidateCode,
	type InvestigationToolCall
} from '$lib/services/ai-investigation-tools';
import type { ReadonlyInvestigationToolName } from '$lib/server/ai-tools';

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
	/** Needed to run the post-generation trial-execution self-correction step. */
	cellId: string;
	sourceTable?: string;
	columns?: InlineCellEditColumn[];
	otherTables?: Array<{ name: string; columns: string[]; columnTypes: string[] }>;
	llmConfig: LLMConfig;
	/** Per-LLM-call timeout sent to the server (default 60s). */
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
	/** Set if the candidate code still failed trial execution after all repair attempts. */
	trialError?: string;
}

interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
	tool_call_id?: string;
}

interface EditCellToolCall {
	id: string;
	tool: string;
	args: Record<string, unknown>;
}

type SSEEvent =
	| { type: 'status'; message: string }
	| { type: 'tool_call'; calls: EditCellToolCall[]; messages: ChatMessage[] }
	| ({
			type: 'result';
			code: string;
			cellType: 'query' | 'python';
			language?: 'sql' | 'prql';
			reasoning?: string;
			suggestedAlternative?: InlineCellEditSuggestedAlternative;
			messages: ChatMessage[];
	  })
	| { type: 'error'; error: string };

// Bounds for the agent loop — enough to genuinely investigate without it wandering.
// "Real loop, ~10-25s, visible progress" per product decision; tool turns and repair
// attempts are capped separately since they serve different purposes (the model choosing
// to look at data, vs. us forcing a fix after a real execution error).
const MAX_TOOL_TURNS = 6;
const MAX_REPAIR_ATTEMPTS = 2;
const OVERALL_BUDGET_MS = 30_000;

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

async function postEditCellTurn(
	input: InlineCellEditInput,
	signal: AbortSignal,
	continuation?: { messages: ChatMessage[]; toolResults?: Array<{ id: string; content: string }> },
	forceFinal?: boolean
): Promise<SSEEvent[]> {
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
			timeoutMs: input.timeoutMs,
			...(continuation && { messages: continuation.messages, toolResults: continuation.toolResults }),
			...(forceFinal && { forceFinal: true })
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
	const events: SSEEvent[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const parts = buffer.split('\n\n');
		buffer = parts.pop() ?? '';
		for (const part of parts) {
			if (!part.startsWith('data: ')) continue;
			events.push(JSON.parse(part.slice(6)) as SSEEvent);
		}
	}
	return events;
}

export async function editCellWithAI(
	input: InlineCellEditInput,
	onProgress?: (message: string) => void
): Promise<InlineCellEditResult | null> {
	const cacheKey = makeCacheKey(input);
	const cached = cacheGet(cacheKey);
	if (cached) return cached;

	_activeController?.abort();
	_activeController = new AbortController();
	const controller = _activeController;
	const signal = controller.signal;
	const budgetTimer = setTimeout(() => controller.abort(), OVERALL_BUDGET_MS);

	try {
		onProgress?.('Generating…');
		let events = await postEditCellTurn(input, signal);
		let toolTurns = 0;
		let repairAttempts = 0;

		while (true) {
			for (const e of events) {
				if (e.type === 'status') onProgress?.(e.message);
			}

			const errorEvent = events.find((e) => e.type === 'error');
			if (errorEvent && errorEvent.type === 'error') throw new Error(errorEvent.error);

			const toolCallEvent = events.find((e) => e.type === 'tool_call');
			if (toolCallEvent && toolCallEvent.type === 'tool_call') {
				toolTurns++;
				const toolResults: Array<{ id: string; content: string }> = [];
				for (const call of toolCallEvent.calls) {
					const result = await executeInvestigationTool({
						tool: call.tool as ReadonlyInvestigationToolName,
						args: call.args
					} satisfies InvestigationToolCall);
					onProgress?.(result.label);
					toolResults.push({ id: call.id, content: result.text });
				}
				const forceFinal = toolTurns >= MAX_TOOL_TURNS;
				onProgress?.(forceFinal ? 'Wrapping up…' : 'Investigating…');
				events = await postEditCellTurn(
					input,
					signal,
					{ messages: toolCallEvent.messages, toolResults },
					forceFinal
				);
				continue;
			}

			const resultEvent = events.find((e) => e.type === 'result');
			if (!resultEvent || resultEvent.type !== 'result') {
				throw new Error('AI stream ended without a result');
			}

			const result: InlineCellEditResult = {
				code: resultEvent.code,
				cellType: resultEvent.cellType,
				language: resultEvent.language,
				reasoning: resultEvent.reasoning,
				suggestedAlternative: resultEvent.suggestedAlternative
			};

			onProgress?.('Testing the result…');
			const trial = await trialRunCandidateCode(input.cellId, result.code, result.cellType, result.language);
			if (trial.ok || repairAttempts >= MAX_REPAIR_ATTEMPTS) {
				if (!trial.ok) result.trialError = trial.error;
				cacheSet(cacheKey, result);
				return result;
			}

			repairAttempts++;
			onProgress?.('Found an error, fixing…');
			events = await postEditCellTurn(input, signal, {
				messages: [
					...resultEvent.messages,
					{
						role: 'user',
						content: `Your code failed when actually run:\n${trial.error}\n\nFix it and return corrected JSON (no tool call needed unless you need to investigate further).`
					}
				]
			});
		}
	} finally {
		clearTimeout(budgetTimer);
		if (_activeController === controller) {
			_activeController = null;
		}
	}
}

export function cancelActiveCellEdit(): void {
	_activeController?.abort();
	_activeController = null;
}
