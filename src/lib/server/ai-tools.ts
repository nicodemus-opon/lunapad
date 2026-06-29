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
}): Promise<LLMToolCallResponse> {
	const isQwen3 = /qwen3/i.test(input.model ?? '');
	const messages =
		isQwen3 && input.messages[0]?.role === 'system'
			? [
					{ ...input.messages[0], content: `${input.messages[0].content}\n/no_think` },
					...input.messages.slice(1)
				]
			: input.messages;

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

	const payload = (await response.json()) as OpenAIToolCallsResponse;
	const message = payload.choices?.[0]?.message;
	const toolCalls: LLMToolCall[] = (message?.tool_calls ?? []).map((tc) => {
		let args: Record<string, unknown> = {};
		try {
			args = JSON.parse(tc.function.arguments || '{}');
		} catch {
			// leave args empty — caller's tool executor will report missing required fields
		}
		return { id: tc.id, name: tc.function.name, args };
	});
	return { content: message?.content ?? null, toolCalls };
}
