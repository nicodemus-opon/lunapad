import type { RequestHandler } from './$types';
import type { AIChatRequest, AIChatToolCall, AIChatToolName, AIChatCell, AIChatSchemaTable } from '$lib/types/ai-chat.js';

export type { AIChatRequest, AIChatToolCall, AIChatToolName, AIChatCell, AIChatSchemaTable };

function formatCellGraph(c: AIChatCell): string {
	const parts: string[] = [`${c.outputName}(${c.language},${c.status})`];
	if (c.upstream?.length) parts.push(`←[${c.upstream.join(',')}]`);
	if (c.downstream?.length) parts.push(`→[${c.downstream.join(',')}]`);
	if (c.usedInDashboards?.length) parts.push(`dash:${c.usedInDashboards.join(',')}`);
	return parts.join(' ');
}

function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	if (/\/v\d+$/i.test(trimmed)) return trimmed;
	return `${trimmed}/v1`;
}

/**
 * Compact, directive prompt for local Ollama models (qwen3, gemma, mistral).
 * Uses explicit <tool_call> tag syntax — smaller models follow explicit templates
 * far more reliably than open-ended native function calling.
 */
function buildSystemPromptOllama(cells: AIChatCell[], schema: AIChatSchemaTable[], workspaceMemory?: string): string {
	const cellList = cells.length > 0
		? cells.map(formatCellGraph).join(', ')
		: 'none';

	const schemaList = schema.length > 0
		? schema.slice(0, 20).map((t) => `${t.name}(${t.columns.slice(0, 10).join(',')})`).join('; ')
		: 'none';

	const memNote = workspaceMemory ? `\nWorkspace history: ${workspaceMemory}` : '';

	return `You are an expert SQL data analyst. Build professional analytical notebooks using tool calls.

TOOL CALL FORMAT — use this EXACT syntax:
Create new cell:  <tool_call>{"tool":"create_cell","callId":"C1","args":{"outputName":"cell_name","cellType":"query","code":"SELECT ..."}}</tool_call>
Markdown cell:    <tool_call>{"tool":"create_cell","callId":"C2","args":{"outputName":"intro","cellType":"markdown","markdown":"## Title\\n\\nText."}}</tool_call>
Update existing:  <tool_call>{"tool":"update_cell","callId":"C3","args":{"cellId":"EXISTING_CELL_ID","code":"SELECT ..."}}</tool_call>
Run cells:        <tool_call>{"tool":"run_cells","callId":"C4","args":{"cellIds":["C1","C2"]}}</tool_call>

RULES:
1. NEVER write SQL in prose. NEVER use code blocks. ALL SQL goes inside tool calls only.
2. To modify an existing cell: use update_cell with its id, NOT create_cell. Always call run_cells after.
3. For new notebooks: create markdown intro cell first, then SQL cells, then run_cells with all cell callIds.
4. NEVER write WITH clauses — each cell's outputName is auto-wrapped as a CTE. Reference upstream cells by name:
   Cell A outputName="monthly_revenue": SELECT strftime('%Y-%m',order_date) AS month, SUM(total_amount) AS revenue FROM orders GROUP BY 1 ORDER BY 1
   Cell B outputName="revenue_mom": SELECT month, revenue, LAG(revenue) OVER (ORDER BY month) AS prev_revenue, ROUND((revenue-LAG(revenue) OVER (ORDER BY month))*100.0/NULLIF(LAG(revenue) OVER (ORDER BY month),0),1) AS mom_pct FROM monthly_revenue ORDER BY month
5. Use window functions (LAG, RANK, SUM OVER) for growth rates, rankings, running totals.
6. Use meaningful aliases and ORDER BY for ranked/time-series results.

You MAY add 1–2 sentences before tool calls to explain your approach.

Notebook cells: ${cellList}
Schema: ${schemaList}${memNote}`;
}

function buildSystemPromptXML(cells: AIChatCell[], schema: AIChatSchemaTable[], workspaceMemory?: string): string {
	const cellList = cells.length > 0
		? cells.map((c) => {
			const up = c.upstream?.length ? ` depends_on=[${c.upstream.join(', ')}]` : '';
			const down = c.downstream?.length ? ` feeds_into=[${c.downstream.join(', ')}]` : '';
			const dash = c.usedInDashboards?.length ? ` dashboards=[${c.usedInDashboards.join(', ')}]` : '';
			return `  id=${c.id} name="${c.outputName}" status=${c.status}${up}${down}${dash}`;
		}).join('\n')
		: '  (none)';

	const schemaList = schema.length > 0
		? schema.slice(0, 30).map((t) => `  ${t.name}: ${t.columns.slice(0, 15).join(', ')}`).join('\n')
		: '  (none)';

	const memSection = workspaceMemory ? `\nWorkspace history: ${workspaceMemory}` : '';

	return `You are an expert data analyst building professional SQL notebooks in Lunapad. Your output must look like a real analyst's deliverable — structured, readable, insightful.

Emit tool calls inline in your response using this exact format:
<tool_call>{"tool":"TOOL_NAME","callId":"C1","args":{...}}</tool_call>

IMPORTANT: callId is how you reference cells later. Use a cell's callId as the cellId argument in set_chart and run_cells.

## Notebook structure (follow this for non-trivial requests)
1. Create a **markdown intro cell** (cellType:"markdown", markdown:"# Analysis Title\\n\\nBrief explanation of goal, data, and approach.")
2. Create focused SQL cells — one logical question per cell, descriptive outputName (e.g. "revenue_by_month", "top_customers_30d")
3. Configure charts for aggregation cells with set_chart
4. Run all cells with run_cells
5. Optionally add a **markdown summary cell** with key findings and what to explore next

## CTE rules (CRITICAL)
1. NEVER write WITH clauses. Each cell's outputName is auto-wrapped as a CTE. Write \`FROM orders\` not \`WITH orders AS (...)\`.
2. DEPENDENCY ORDER: if cell B reads FROM cell A, create cell A FIRST in your tool call sequence.
3. Verify dependencies exist in the Notebook list; if not, create them first.

## SQL quality
- Use meaningful column aliases (revenue, order_count, avg_value — not col1, val)
- Prefer explicit column lists over SELECT *
- Include ORDER BY for ranked/time-series results
- Cast dates/timestamps when grouping by period

## Response format
- Use markdown in your prose: **bold** key findings, bullet lists for multiple points, \`code\` for cell/table names
- Keep explanations tight — the notebook cells speak for themselves
- For complex analyses, emit a \`<plan>\` block before tool calls

## Tools (action)
- create_cell: {outputName:string, code:string, language:"sql", cellType?:"query"|"markdown", markdown?:string}
  - For markdown cells use short descriptive outputNames: intro, overview, summary, insights, methodology, findings
  - For SQL cells use snake_case names describing the query: revenue_by_month, top_customers, order_funnel
- set_chart: {cellId:string, chartConfig:{chartType:"bar"|"line"|"area"|"scatter"|"pie", xColumn:string, yColumns:string[], title?:string}}
- run_cells: {cellIds:string[]} — always run all created query cells
- update_cell: {cellId:string, code?:string, outputName?:string}
- delete_cell: {cellId:string}

## Tools (lookup — use before generating SQL)
- get_lineage: {outputName:string}
- find_dashboard_usage: {outputName:string}
- list_cells: {}
- search_workspace: {query:string}

## Plan format (for complex requests)
<plan>{"tables":["table1"],"cells":["cell_name"],"approach":"one sentence"}</plan>

## Graph notation
depends_on=[x] = reads FROM x. feeds_into=[x] = x reads FROM this. dashboards=[x] = used in dashboard x.

Notebook:
${cellList}
Schema:
${schemaList}${memSection}

Respond with concise prose and inline tool calls. Make the notebook beautiful.`;
}

// Native OpenAI-format tool definitions (kept minimal to reduce token count)
// Lookup tools run client-side; they inject results as text into the message thread.
const NATIVE_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'create_cell',
			description: 'MANDATORY: Use this for every SQL query and every markdown block. Never write SQL in text. For SQL cells: cellType="query", complete SQL in "code". For prose/explanation: cellType="markdown", GitHub-flavored markdown in "markdown" (# headers, **bold**, bullet lists). Markdown outputNames: intro, overview, summary, insights, methodology, findings. SQL outputNames: revenue_by_month, top_customers, order_funnel (snake_case).',
			parameters: {
				type: 'object',
				properties: {
					outputName: { type: 'string', description: 'For markdown: short word (intro, summary, findings). For SQL: snake_case description (revenue_by_month, top_customers).' },
					cellType: { type: 'string', enum: ['query', 'markdown'], description: 'query for SQL, markdown for explanatory prose' },
					code: { type: 'string', description: 'Complete SQL for query cells. Omit for markdown cells.' },
					markdown: { type: 'string', description: 'GFM markdown content for markdown cells. Use headers (# ## ###), **bold**, bullet lists, `code` spans.' },
					language: { type: 'string', enum: ['sql'], description: 'Always "sql" for query cells.' }
				},
				required: ['outputName', 'cellType']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_chart',
			description: 'Configure a chart visualization for a cell. Infer columns from the SELECT clause.',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string' },
					chartConfig: {
						type: 'object',
						properties: {
							chartType: { type: 'string', enum: ['bar', 'line', 'area', 'scatter', 'pie'] },
							xColumn: { type: 'string' },
							yColumns: { type: 'array', items: { type: 'string' } },
							title: { type: 'string' }
						},
						required: ['chartType', 'xColumn', 'yColumns']
					}
				},
				required: ['cellId', 'chartConfig']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_cells',
			description: 'Execute cells. Call after creating/updating query cells.',
			parameters: {
				type: 'object',
				properties: {
					cellIds: { type: 'array', items: { type: 'string' } }
				},
				required: ['cellIds']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'update_cell',
			description: 'Edit SQL code of an existing cell.',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string' },
					code: { type: 'string' }
				},
				required: ['cellId']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_lineage',
			description: 'Returns upstream (depends_on) and downstream (feeds_into) cells for a given outputName, plus dashboard usage. Call before modifying a cell to understand impact.',
			parameters: {
				type: 'object',
				properties: { outputName: { type: 'string', description: 'The cell outputName to inspect' } },
				required: ['outputName']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'find_dashboard_usage',
			description: 'Returns which dashboards reference a given cell by outputName.',
			parameters: {
				type: 'object',
				properties: { outputName: { type: 'string' } },
				required: ['outputName']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_cells',
			description: 'Lists all query cells with status and row counts. Use when you need a full inventory of existing cells.',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_workspace',
			description: 'Semantic search over existing cells and schema tables. Use before generating SQL to find relevant existing models.',
			parameters: {
				type: 'object',
				properties: { query: { type: 'string', description: 'Natural language search query' } },
				required: ['query']
			}
		}
	}
];

function buildUserContent(cells: AIChatCell[], messages: Array<{ role: string; content: string }>): string {
	// Attach full code for cells referenced in recent user messages
	const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
	const referencedOutputNames = new Set(
		cells.filter((c) => lastUserMsg.includes(c.outputName)).map((c) => c.outputName)
	);

	const codeBlocks = cells
		.filter((c) => referencedOutputNames.has(c.outputName) && c.code.trim())
		.map((c) => `### Cell: ${c.outputName} (${c.language})\n\`\`\`sql\n${c.code}\n\`\`\``)
		.join('\n\n');

	return codeBlocks ? `${lastUserMsg}\n\n${codeBlocks}` : lastUserMsg;
}

interface SSEController {
	enqueue: (data: string) => void;
	close: () => void;
}

function send(sc: SSEController, event: Record<string, unknown>): void {
	try {
		sc.enqueue(`data: ${JSON.stringify(event)}\n\n`);
	} catch {
		// stream closed
	}
}

/** Extract complete <plan>...</plan> blocks from buffer, emit plan_delta events. */
function flushPlanBlocks(buffer: string, onPlan: (raw: string) => void): string {
	const OPEN = '<plan>';
	const CLOSE = '</plan>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onPlan(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <tool_call>...</tool_call> blocks from buffer, emit events for each. */
function flushToolCalls(buffer: string, onToolCall: (raw: string) => void): string {
	const TAG_OPEN = '<tool_call>';
	const TAG_CLOSE = '</tool_call>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(TAG_OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(TAG_CLOSE, start + TAG_OPEN.length);
		if (end === -1) break; // incomplete — keep in buffer

		const raw = remaining.slice(start + TAG_OPEN.length, end).trim();
		onToolCall(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + TAG_CLOSE.length);
		searchFrom = start;
	}

	return remaining;
}

/**
 * Some small Ollama models output raw JSON tool call objects as text content
 * instead of using the native tool_calls delta. This function detects and
 * extracts those anywhere in the text — normalising "arguments" → "args" —
 * then returns the text with JSON tool calls removed.
 *
 * Handles:
 *   {"tool":"create_cell","arguments":{...}}         (Ollama fallback format)
 *   {"tool":"create_cell","args":{...}}              (our XML schema format)
 *   {"tool":"create_cell","callId":"C1","args":{...}}
 *   Prose before/after the JSON is preserved.
 */
function extractRawJsonToolCalls(
	text: string,
	onToolCall: (raw: string) => void
): string {
	let result = text;

	while (true) {
		// Find the next {"tool": pattern anywhere in remaining text
		const matchIdx = result.search(/\{"tool"\s*:/);
		if (matchIdx === -1) break;

		// Find balanced braces starting from matchIdx
		let depth = 0, end = -1;
		for (let i = matchIdx; i < result.length; i++) {
			if (result[i] === '{') depth++;
			else if (result[i] === '}') {
				depth--;
				if (depth === 0) { end = i; break; }
			}
		}
		if (end === -1) break; // incomplete JSON — leave in buffer

		const candidate = result.slice(matchIdx, end + 1);
		try {
			const obj = JSON.parse(candidate) as Record<string, unknown>;
			if (typeof obj.tool === 'string') {
				// Normalise "arguments" → "args"
				if (obj.arguments !== undefined && obj.args === undefined) {
					obj.args = obj.arguments;
					delete obj.arguments;
				}
				onToolCall(JSON.stringify(obj));
				result = result.slice(0, matchIdx) + result.slice(end + 1);
				continue;
			}
		} catch { /* not valid JSON — skip past this match */ }
		break;
	}

	return result;
}

/**
 * Strip complete and partial <think>...</think> blocks from buffered text.
 * Thinking models (e.g. qwen3) emit these before their actual response.
 * Complete blocks are removed; if a block is open but not yet closed, strip
 * from the opening tag onward (it may still be streaming).
 */
function stripThinkBlocks(text: string): string {
	// Remove complete <think>...</think> blocks
	let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');
	// Remove incomplete open block (no closing tag yet)
	const openIdx = result.lastIndexOf('<think>');
	if (openIdx !== -1 && result.indexOf('</think>', openIdx) === -1) {
		result = result.slice(0, openIdx);
	}
	return result;
}

/**
 * Return the safe-to-emit prefix of `text` by stripping any incomplete
 * tag or raw JSON tool call at the tail. Handles:
 *   - a complete open tag with no close: "<tool_call>{"  → strips from "<"
 *   - a partial open tag at end: "<tool_ca" or just "<" → strips the partial
 *   - an incomplete {"tool":...} JSON at end (in-progress raw JSON tool call)
 */
function stripOpenTag(text: string): string {
	const TAG = '<tool_call>';

	// Remove complete open tag that has no matching close
	const idx = text.lastIndexOf('<tool_call>');
	if (idx !== -1 && text.indexOf('</tool_call>', idx) === -1) {
		return text.slice(0, idx);
	}

	// Remove partial tag at end (e.g. "<tool_ca", "<t", "<")
	const maxPartial = TAG.length - 1;
	const start = Math.max(0, text.length - maxPartial);
	for (let i = start; i < text.length; i++) {
		if (TAG.startsWith(text.slice(i))) {
			return text.slice(0, i);
		}
	}

	// Hold back incomplete raw JSON tool call at end of buffer.
	// (When a model outputs {"tool":...} as plain text, we need to wait
	// for the complete object before extractRawJsonToolCalls can extract it.)
	const jsonIdx = text.search(/\{"tool"\s*:/);
	if (jsonIdx !== -1) {
		let depth = 0;
		for (let i = jsonIdx; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}') { depth--; if (depth === 0) break; }
		}
		if (depth > 0) return text.slice(0, jsonIdx); // incomplete — hold back
	}

	return text;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<AIChatRequest>;
	try {
		body = (await request.json()) as Partial<AIChatRequest>;
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
	}

	if (!body.llmConfig?.baseUrl?.trim() || !body.llmConfig?.model?.trim()) {
		return new Response(JSON.stringify({ error: 'llmConfig with baseUrl and model is required' }), { status: 400 });
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		return new Response(JSON.stringify({ error: 'messages array is required' }), { status: 400 });
	}

	const req = body as AIChatRequest;
	const { cells, connectionSchema } = req.notebookContext ?? { cells: [], connectionSchema: [] };
	const workspaceMemory = req.workspaceMemory;
	const completionUrl = `${normalizeBaseUrl(req.llmConfig.baseUrl)}/chat/completions`;

	// Local Ollama models use a compact directive prompt with explicit <tool_call> XML tags.
	// The full XML prompt is designed for smart cloud models (GPT-4, Claude) — it overwhelms
	// small models like qwen3:4b which need a much shorter, more directive template.
	const isOllama = req.llmConfig.provider === 'ollama';
	const useNativeTools = false;

	const systemPrompt = isOllama
		? buildSystemPromptOllama(cells, connectionSchema, workspaceMemory)
		: buildSystemPromptXML(cells, connectionSchema, workspaceMemory);
	const enhancedLastUserContent = buildUserContent(cells, req.messages);

	// Build message list.
	// req.messages includes [history..., latestUser, emptyAssistantPlaceholder].
	// slice(0, -2) removes both so we can append the enhanced user message once at the end.
	const olderMessages = req.messages.slice(0, -2).map((m) => ({
		role: m.role as 'user' | 'assistant',
		content: m.content
	}));
	// For Ollama: use the message as-is. Thinking (if the model supports it) helps quality.
	const lastUserContent = enhancedLastUserContent;

	const llmMessages = [
		{ role: 'system' as const, content: systemPrompt },
		...olderMessages,
		{ role: 'user' as const, content: lastUserContent }
	];

	const controller = new AbortController();
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(sc) {
			const ctrl: SSEController = {
				enqueue: (data) => sc.enqueue(encoder.encode(data)),
				close: () => { try { sc.close(); } catch { /* already closed */ } }
			};

			let buffer = '';
			let nativeTextBuf = '';
			let callCounter = 0;

			try {
				const llmBody: Record<string, unknown> = {
					model: req.llmConfig.model,
					temperature: 0.2,
					stream: true,
					messages: llmMessages,
					// Ollama thinking models (qwen3, deepseek-r1) consume reasoning tokens before
					// producing any output. 2048 is exhausted by reasoning alone on complex requests.
					// Cloud providers (OpenAI, Anthropic) don't have this overhead.
					max_tokens: isOllama ? 8192 : 4096
				};
				// Disable extended thinking for Ollama — it dramatically increases latency
				// for interactive use without meaningful SQL quality gains at these model sizes.
				if (isOllama) {
					llmBody['think'] = false;
				}
				if (useNativeTools) {
					llmBody['tools'] = NATIVE_TOOLS;
					llmBody['tool_choice'] = 'auto';
				}

				const response = await fetch(completionUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(llmBody),
					signal: controller.signal
				});

				if (!response.ok) {
					const errText = await response.text();
					send(ctrl, { type: 'error', error: `LLM error (${response.status}): ${errText.slice(0, 300)}` });
					ctrl.close();
					return;
				}

				const reader = response.body!.getReader();
				const dec = new TextDecoder();

				// Accumulate native tool call arguments per index
				const nativeToolCallBuf: Record<number, { id: string; name: string; argsBuf: string }> = {};

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = dec.decode(value, { stream: true });

					for (const line of chunk.split('\n')) {
						const trimmed = line.trim();
						if (!trimmed.startsWith('data:')) continue;
						const data = trimmed.slice(5).trim();
						if (data === '[DONE]') continue;

						let parsed: unknown;
						try { parsed = JSON.parse(data); } catch { continue; }

						type DeltaChunk = {
							choices?: Array<{
								delta?: {
									content?: string;
									tool_calls?: Array<{
										index: number;
										id?: string;
										type?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
							}>;
						};
						const choice = (parsed as DeltaChunk)?.choices?.[0];
						if (!choice) continue;

						// ── Native tool calls (Ollama) ──────────────────────────────────
						if (useNativeTools && choice.delta?.tool_calls) {
							for (const tc of choice.delta.tool_calls) {
								const idx = tc.index ?? 0;
								if (!nativeToolCallBuf[idx]) {
									nativeToolCallBuf[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', argsBuf: '' };
								}
								if (tc.id) nativeToolCallBuf[idx].id = tc.id;
								if (tc.function?.name) nativeToolCallBuf[idx].name = tc.function.name;
								if (tc.function?.arguments) nativeToolCallBuf[idx].argsBuf += tc.function.arguments;
							}
						}

						// ── Text content ─────────────────────────────────────────────
						const content = choice.delta?.content;
						if (typeof content === 'string' && content !== '') {
							if (useNativeTools) {
								// Buffer native text to extract <think>, <plan>, and raw JSON tool calls
								nativeTextBuf += content;
								nativeTextBuf = stripThinkBlocks(nativeTextBuf);
								nativeTextBuf = flushPlanBlocks(nativeTextBuf, (rawJson) => {
									try {
										const plan = JSON.parse(rawJson) as { tables?: string[]; cells?: string[]; approach?: string };
										send(ctrl, { type: 'plan_delta', plan });
									} catch { /* skip malformed plan */ }
								});
								// Extract any complete raw JSON tool calls mid-stream (models that
								// output {"tool":"...", "arguments":{...}} as text content)
								nativeTextBuf = extractRawJsonToolCalls(nativeTextBuf, (rawJson) => {
									try {
										const call = JSON.parse(rawJson) as Partial<AIChatToolCall>;
										if (typeof call.tool !== 'string') return;
										callCounter++;
										const toolCall: AIChatToolCall = {
											callId: call.callId ?? `auto_${callCounter}`,
											tool: call.tool as AIChatToolName,
											args: (call.args ?? {}) as AIChatToolCall['args']
										};
										send(ctrl, { type: 'tool_call', call: toolCall });
									} catch { /* skip */ }
								});
								// stripOpenTag also holds back incomplete {"tool":...} at the tail
								const safeNative = stripOpenTag(nativeTextBuf);
								if (safeNative.length > 0) {
									send(ctrl, { type: 'text_delta', delta: safeNative });
									nativeTextBuf = nativeTextBuf.slice(safeNative.length);
								}
							} else {
								buffer += content;
								// Extract complete <plan> blocks first
								buffer = flushPlanBlocks(buffer, (rawJson) => {
									try {
										const plan = JSON.parse(rawJson) as { tables?: string[]; cells?: string[]; approach?: string };
										send(ctrl, { type: 'plan_delta', plan });
									} catch { /* skip malformed plan */ }
								});
								// Extract complete XML tool calls from buffer
								buffer = flushToolCalls(buffer, (rawJson) => {
									try {
										const call = JSON.parse(rawJson) as Partial<AIChatToolCall>;
										if (typeof call.tool !== 'string') return;
										callCounter++;
										const toolCall: AIChatToolCall = {
											callId: call.callId ?? `auto_${callCounter}`,
											tool: call.tool as AIChatToolName,
											args: (call.args ?? {}) as AIChatToolCall['args']
										};
										send(ctrl, { type: 'tool_call', call: toolCall });
									} catch { /* skip malformed */ }
								});
								// Flush text not part of a partial tool_call tag or plan tag
								const safeText = stripOpenTag(buffer);
								if (safeText.length > 0) {
									send(ctrl, { type: 'text_delta', delta: safeText });
									buffer = buffer.slice(safeText.length);
								}
							}
						}
					}
				}

				// Flush any remaining native text buffer
				if (useNativeTools && nativeTextBuf.trim()) {
					nativeTextBuf = stripThinkBlocks(nativeTextBuf);
					nativeTextBuf = flushPlanBlocks(nativeTextBuf, (rawJson) => {
						try {
							const plan = JSON.parse(rawJson) as { tables?: string[]; cells?: string[]; approach?: string };
							send(ctrl, { type: 'plan_delta', plan });
						} catch { /* skip */ }
					});
					// Fallback: some models emit raw JSON tool calls as text content
					// rather than using the native tool_calls delta format.
					nativeTextBuf = extractRawJsonToolCalls(nativeTextBuf.trim(), (rawJson) => {
						try {
							const call = JSON.parse(rawJson) as Partial<AIChatToolCall>;
							if (typeof call.tool !== 'string') return;
							callCounter++;
							const toolCall: AIChatToolCall = {
								callId: call.callId ?? `auto_${callCounter}`,
								tool: call.tool as AIChatToolName,
								args: (call.args ?? {}) as AIChatToolCall['args']
							};
							send(ctrl, { type: 'tool_call', call: toolCall });
						} catch { /* skip */ }
					});
					if (nativeTextBuf.trim()) send(ctrl, { type: 'text_delta', delta: nativeTextBuf.trim() });
				}

				// Emit any accumulated native tool calls
				for (const tc of Object.values(nativeToolCallBuf)) {
					if (!tc.name) continue;
					callCounter++;
					let args: unknown = {};
					try { args = JSON.parse(tc.argsBuf || '{}'); } catch { /* skip */ }
					const toolCall: AIChatToolCall = {
						callId: tc.id || `auto_${callCounter}`,
						tool: tc.name as AIChatToolName,
						args: args as AIChatToolCall['args']
					};
					send(ctrl, { type: 'tool_call', call: toolCall });
				}

				// Flush remaining XML buffer
				if (!useNativeTools && buffer.trim()) {
					buffer = flushToolCalls(buffer, (rawJson) => {
						try {
							const call = JSON.parse(rawJson) as Partial<AIChatToolCall>;
							if (typeof call.tool !== 'string') return;
							callCounter++;
							const toolCall: AIChatToolCall = {
								callId: call.callId ?? `auto_${callCounter}`,
								tool: call.tool as AIChatToolName,
								args: (call.args ?? {}) as AIChatToolCall['args']
							};
							send(ctrl, { type: 'tool_call', call: toolCall });
						} catch { /* skip */ }
					});
					const finalText = stripOpenTag(buffer).trim();
					if (finalText) send(ctrl, { type: 'text_delta', delta: finalText });
				}

				send(ctrl, { type: 'done' });
			} catch (err) {
				if (!(err instanceof Error && err.name === 'AbortError')) {
					send(ctrl, { type: 'error', error: err instanceof Error ? err.message : 'Internal error' });
				}
			} finally {
				ctrl.close();
			}
		},
		cancel() {
			controller.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
