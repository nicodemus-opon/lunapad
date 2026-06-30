// Shared OpenAI-function-calling schemas for the read-only investigation tools. These are the
// only tools the inline Cmd+K agent (`/api/ai/edit-cell`) is ever given — they look at data and
// notebook state but never mutate anything. The sidebar chat agent (`/api/ai/chat`) also uses
// these exact definitions (concatenated with its own mutating tools) so both surfaces stay in
// sync; the actual client-side execution lives in `$lib/services/ai-investigation-tools.ts`.

export const READONLY_INVESTIGATION_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'get_lineage',
			description:
				'Returns upstream (depends_on) and downstream (feeds_into) cells for a given outputName, plus dashboard usage. Call before modifying a cell to understand impact.',
			parameters: {
				type: 'object',
				properties: {
					outputName: { type: 'string', description: 'The cell outputName to inspect' }
				},
				required: ['outputName']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_workspace',
			description:
				'Semantic search over existing cells and schema tables. Use before generating SQL to find relevant existing models.',
			parameters: {
				type: 'object',
				properties: { query: { type: 'string', description: 'Natural language search query' } },
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'sample_data',
			description:
				'Fetch a random sample of rows from a named table. Use to understand data shape before writing queries.',
			parameters: {
				type: 'object',
				properties: {
					table: { type: 'string', description: 'Table name as it appears in the schema.' },
					n: { type: 'number', description: 'Number of sample rows (default 10, max 50).' }
				},
				required: ['table']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'profile_column',
			description:
				'Get null rate, distinct count, min/max, and top 5 values for a column. Use before GROUP BY or JOIN to understand cardinality.',
			parameters: {
				type: 'object',
				properties: {
					table: { type: 'string', description: 'Table name.' },
					column: { type: 'string', description: 'Column name to profile.' }
				},
				required: ['table', 'column']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_cell_result',
			description:
				"Read an already-run cell's result data without re-executing the query. Use to see upstream data shape or an upstream cell's error.",
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string', description: 'Cell id or outputName to read result from.' },
					limit: { type: 'number', description: 'Max rows to return (default 50, max 100).' }
				},
				required: ['cellId']
			}
		}
	}
] as const;

export type ReadonlyInvestigationToolName = (typeof READONLY_INVESTIGATION_TOOLS)[number]['function']['name'];

export const READONLY_INVESTIGATION_TOOL_NAMES: ReadonlyInvestigationToolName[] =
	READONLY_INVESTIGATION_TOOLS.map((t) => t.function.name);

// ── Tool-aware chat completion helper ───────────────────────────────────────────
// Used by /api/ai/edit-cell's multi-turn loop. Unlike callLLMJson (single-shot,
// forces response_format: json_object), this calls a model with native function-calling
// and lets it either call a tool or answer directly — the caller decides what to do with
// tool_calls vs content. Native function-calling only (no XML-tag fallback for models that
// don't support it) — a deliberate scope cut to avoid re-deriving the sidebar chat agent's
// dual-format streaming parser; models without tool support simply answer directly with no
// tool calls, which still works, just without the investigation step.

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
	tool_call_id?: string;
}

export interface LLMToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface LLMToolCallResponse {
	content: string | null;
	toolCalls: LLMToolCall[];
}

interface OpenAIToolCallsResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
			tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
		};
	}>;
}

export async function callLLMWithTools(input: {
	completionUrl: string;
	model: string;
	messages: ChatMessage[];
	/** Omit to force a final text answer (no tool calls possible). */
	tools?: typeof READONLY_INVESTIGATION_TOOLS;
	signal: AbortSignal;
	apiKey?: string;
	/** Called with each content chunk when the model is producing a text answer.
	 *  Presence enables streaming mode (stream:true). Not called for tool-call turns. */
	onDelta?: (chunk: string) => void;
}): Promise<LLMToolCallResponse> {
	const isQwen3 = /qwen3/i.test(input.model ?? '');
	const messages =
		isQwen3 && input.messages[0]?.role === 'system'
			? [
					{ ...input.messages[0], content: `${input.messages[0].content}\n/no_think` },
					...input.messages.slice(1)
				]
			: input.messages;

	const useStream = !!input.onDelta;

	const response = await fetch(input.completionUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
		},
		body: JSON.stringify({
			model: input.model,
			temperature: 0.2,
			top_p: 0.9,
			stream: useStream,
			...(isQwen3 ? { options: { think: false } } : {}),
			...(input.tools ? { tools: input.tools, tool_choice: 'auto' } : {}),
			messages
		}),
		signal: input.signal
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 400)}`);
	}

	if (!useStream) {
		const payload = (await response.json()) as OpenAIToolCallsResponse;
		const message = payload.choices?.[0]?.message;
		const toolCalls: LLMToolCall[] = (message?.tool_calls ?? []).map((tc) => {
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(tc.function.arguments || '{}');
			} catch {
				// leave args empty
			}
			return { id: tc.id, name: tc.function.name, args };
		});
		return { content: message?.content ?? null, toolCalls };
	}

	// ── Streaming path ──────────────────────────────────────────────────────────
	// Some providers return application/json even when asked for streaming — fall back.
	const ct = response.headers.get('content-type') ?? '';
	if (!ct.includes('text/event-stream') && !ct.includes('application/x-ndjson')) {
		const payload = (await response.json()) as OpenAIToolCallsResponse;
		const message = payload.choices?.[0]?.message;
		const toolCalls: LLMToolCall[] = (message?.tool_calls ?? []).map((tc) => {
			let args: Record<string, unknown> = {};
			try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
			return { id: tc.id, name: tc.function.name, args };
		});
		return { content: message?.content ?? null, toolCalls };
	}

	// Raw accumulated text — may include <think>…</think> blocks from reasoning models.
	// These appear in delta.content during streaming but are stripped from message.content
	// in non-streaming responses, so we strip them before returning.
	let rawContent = '';
	const tcMap = new Map<number, { id: string; name: string; args: string }>();
	// Track whether we're inside a think block so onDelta skips those tokens.
	let insideThink = false;

	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buf = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const lines = buf.split('\n');
		buf = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const raw = line.slice(6).trim();
			if (raw === '[DONE]') continue;
			let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
			try {
				chunk = JSON.parse(raw);
			} catch {
				continue;
			}
			const delta = chunk.choices?.[0]?.delta;
			if (!delta) continue;
			if (delta.content) {
				rawContent += delta.content;
				// Route chunk to onDelta, stripping think-block content.
				// A single chunk may open *and* close a think block, so we
				// process iteratively rather than with a simple flag flip.
				let remaining = delta.content;
				while (remaining) {
					if (insideThink) {
						const end = remaining.indexOf('</think>');
						if (end === -1) { remaining = ''; break; }
						insideThink = false;
						remaining = remaining.slice(end + '</think>'.length);
					} else {
						const start = remaining.indexOf('<think>');
						if (start === -1) { input.onDelta!(remaining); remaining = ''; break; }
						if (start > 0) input.onDelta!(remaining.slice(0, start));
						insideThink = true;
						remaining = remaining.slice(start + '<think>'.length);
					}
				}
			}
			if (delta.tool_calls) {
				for (const tc of delta.tool_calls) {
					if (!tcMap.has(tc.index)) tcMap.set(tc.index, { id: '', name: '', args: '' });
					const entry = tcMap.get(tc.index)!;
					if (tc.id) entry.id = tc.id;
					if (tc.function?.name) entry.name += tc.function.name;
					if (tc.function?.arguments) entry.args += tc.function.arguments;
				}
			}
		}
	}

	// Strip reasoning blocks — present in streaming but absent in non-streaming message.content.
	const content = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

	const toolCalls: LLMToolCall[] = [...tcMap.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, tc]) => {
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(tc.args || '{}');
			} catch {
				// leave args empty
			}
			return { id: tc.id, name: tc.name, args };
		});
	return { content: content || null, toolCalls };
}

// ── Plain-text completion helper ────────────────────────────────────────────────
// Used by /api/ai/complete (ghost-text inline completion). Unlike callLLMWithTools and
// callLLMJson, this never sends `tools` or `response_format` — a JSON wrapper would have
// the model pad a raw code completion with `{"code": ...}` boilerplate that eats into the
// already-tiny max_tokens budget for no benefit. Single-shot, no streaming: the caller
// (the /complete route) applies its own short, fixed timeout via its AbortSignal.

const COMPLETION_MIN_TIMEOUT_MS = 500;
const COMPLETION_MAX_TIMEOUT_MS = 4_000;
const COMPLETION_DEFAULT_TIMEOUT_MS = 1_800;

export function normalizeCompletionTimeoutMs(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return COMPLETION_DEFAULT_TIMEOUT_MS;
	return Math.max(COMPLETION_MIN_TIMEOUT_MS, Math.min(COMPLETION_MAX_TIMEOUT_MS, Math.round(value)));
}

interface OpenAITextResponse {
	choices?: Array<{ message?: { content?: string | null } }>;
}

export async function callLLMText(input: {
	completionUrl: string;
	model: string;
	systemPrompt: string;
	userPrompt: string;
	maxTokens?: number;
	signal: AbortSignal;
	apiKey?: string;
	/** Gates the Ollama-specific think-disabling flags below — sending them to a real
	 *  OpenAI-compatible cloud endpoint risks an "unrecognized field" rejection. */
	provider?: string;
}): Promise<string> {
	const isQwen3 = /qwen3/i.test(input.model ?? '');
	const isOllama = input.provider === 'ollama';
	const systemContent = isQwen3 ? `${input.systemPrompt}\n/no_think` : input.systemPrompt;

	const response = await fetch(input.completionUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
		},
		body: JSON.stringify({
			model: input.model,
			temperature: 0.2,
			top_p: 0.9,
			stream: false,
			max_tokens: input.maxTokens ?? 160,
			// Best-effort — not every reasoning-capable Ollama model honors this, but it's
			// free to send and helps the ones that do (sanitizeCompletion also strips any
			// literal <think> tags that slip through as defense-in-depth).
			...(isOllama ? { think: false, options: { think: false } } : {}),
			messages: [
				{ role: 'system', content: systemContent },
				{ role: 'user', content: input.userPrompt }
			]
		}),
		signal: input.signal
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 400)}`);
	}

	const payload = (await response.json()) as OpenAITextResponse;
	return payload.choices?.[0]?.message?.content ?? '';
}
