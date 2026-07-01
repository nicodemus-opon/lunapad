import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	normalizeTimeoutMs,
	normalizeBaseUrl,
	quoteIdent,
	buildSchemaBlock,
	rankColumnsByRelevance,
	type SchemaColumn,
	type OtherTable
} from '$lib/server/ai-schema-context';
import {
	READONLY_INVESTIGATION_TOOLS,
	callLLMWithTools,
	type ChatMessage
} from '$lib/server/ai-tools';

// Inline "Tell AI what to do" cell edit — a bounded multi-turn agent loop, sibling to
// /api/llm/generate-prql rather than a generalization of it (that endpoint's PRQL-idiom
// postprocessing is too PRQL-specific to branch three ways cleanly; only schema-context
// building is shared). Unlike a single-shot completion, this loop can call the 5 read-only
// investigation tools (sample_data, profile_column, get_cell_result, get_lineage,
// search_workspace) before answering — execution of those tools is entirely client-side
// (notebook/connection state lives in the browser), so this endpoint is stateless: each
// request is one LLM turn, and the client drives the loop by re-posting with `messages` +
// `toolResults`. Trial-execution self-correction (the "fix its bugs" step) also happens
// client-side, for the same reason — see `trialRunCandidateCode` in
// `$lib/services/ai-investigation-tools.ts`.

export interface EditCellRequest {
	instruction: string;
	cellType: 'query' | 'python';
	/** Required when cellType is 'query'; omitted for python. */
	language?: 'prql' | 'sql';
	existingCode: string;
	sourceTable?: string;
	columns: SchemaColumn[];
	otherTables?: OtherTable[];
	llmConfig: { provider: string; baseUrl: string; model: string; apiKey?: string };
	timeoutMs?: number;
	/** Present on continuation turns (after a tool call or a trial-execution repair). */
	messages?: ChatMessage[];
	/** Results for the tool_calls sent in the previous turn's `tool_call` event. */
	toolResults?: Array<{ id: string; content: string }>;
	/** Set once the client has hit its tool-call turn cap — forces a final answer. */
	forceFinal?: boolean;
}

export interface EditCellToolCall {
	id: string;
	tool: string;
	args: Record<string, unknown>;
}

export interface EditCellSuggestedAlternative {
	cellType: 'query' | 'python';
	language?: 'sql' | 'prql';
	reason: string;
}

export interface EditCellResult {
	code: string;
	cellType: 'query' | 'python';
	language?: 'sql' | 'prql';
	reasoning?: string;
	suggestedAlternative?: EditCellSuggestedAlternative;
}

interface LLMEditResponse {
	code?: string;
	reasoning?: string;
	suggestedAlternative?: { cellType?: string; language?: string; reason?: string };
}

function extractEditResponse(content: string): LLMEditResponse | null {
	const fencedBlocks: string[] = [];
	const fenceRe = /```[a-z]*\s*([\s\S]+?)```/gi;
	let fenceMatch: RegExpExecArray | null;
	while ((fenceMatch = fenceRe.exec(content)) !== null) {
		fencedBlocks.push(fenceMatch[1].trim());
	}
	if (content.includes('{') && content.includes('}')) {
		fencedBlocks.push(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1).trim());
	}

	for (const candidate of fencedBlocks) {
		try {
			const parsed = JSON.parse(candidate) as LLMEditResponse;
			if (typeof parsed.code === 'string' && parsed.code.trim()) return parsed;
		} catch {
			// try next candidate
		}
	}
	return null;
}

function normalizeSuggestedAlternative(
	raw: LLMEditResponse['suggestedAlternative'],
	currentCellType: 'query' | 'python'
): EditCellSuggestedAlternative | undefined {
	if (!raw?.reason?.trim()) return undefined;
	const cellType = raw.cellType === 'python' ? 'python' : raw.cellType === 'query' ? 'query' : null;
	if (!cellType || cellType === currentCellType) return undefined;
	const language = raw.language === 'sql' || raw.language === 'prql' ? raw.language : undefined;
	return { cellType, language, reason: raw.reason.trim() };
}

function buildSystemPrompt(req: EditCellRequest): string {
	const langLabel = req.cellType === 'python' ? 'Python' : req.language === 'prql' ? 'PRQL' : 'SQL';
	const altGuidance =
		req.cellType === 'python'
			? `If this task would actually be better as a SQL cell (a straightforward relational transform), set "suggestedAlternative": {"cellType":"query","language":"sql","reason":"..."}.`
			: `If this task would actually be better as a Python cell (statistics, ML, text/regex processing, or custom visualization beyond simple charts), set "suggestedAlternative": {"cellType":"python","reason":"..."}. Only suggest this when it is clearly a better fit — most relational requests should stay in ${langLabel}.`;

	const pythonEnvNote =
		req.cellType === 'python'
			? `
Python execution environment:
- pandas (as pd), numpy (as np), plotly.graph_objects (as go) are pre-imported.
- Upstream query cells are injected as pandas DataFrames — the variable name is the cell's outputName (e.g. if an upstream cell is named "sales", use \`sales\` directly).
- The notebook namespace is shared: imports and variables from earlier cells are already available.
- To return tabular data, assign a DataFrame to \`result\` or make it the last expression.
- To return a chart, assign a Plotly Figure to any variable (or make it the last expression).`
			: '';

	return `You are editing a single ${langLabel} notebook cell in place, based on a short instruction.

The cell currently contains:
\`\`\`
${req.existingCode || '(empty)'}
\`\`\`
${pythonEnvNote}
You may call read-only tools (sample_data, profile_column, get_cell_result, get_lineage, search_workspace) to investigate real data or notebook state BEFORE answering — e.g. to check actual values/date formats, see an upstream cell's error or shape, or find a reusable model elsewhere. Only call a tool when it would genuinely change your answer; skip tools for trivial edits.

When you are done investigating, respond with ONLY valid JSON and no tool call: {"code": "...", "reasoning": "...", "suggestedAlternative"?: {...}}

Apply the user's instruction to produce the FULL new cell code (not a diff) in the "code" field, written in ${langLabel}. Keep changes minimal and scoped to the instruction — don't rewrite unrelated parts of the cell.
${altGuidance}
Always still produce the best possible "code" in ${langLabel} even when suggesting an alternative — never leave "code" empty.`;
}

function buildUserPrompt(req: EditCellRequest): string {
	const parts = [`Instruction: ${req.instruction}`];
	if (req.sourceTable && req.columns.length > 0) {
		const relevantColumns = rankColumnsByRelevance(req.instruction, req.columns);
		parts.push('', 'Schema:', buildSchemaBlock(req.sourceTable, relevantColumns, req.otherTables));
		parts.push(
			`Remember: ONLY use column names from this list: ${relevantColumns.map((c) => quoteIdent(c.name)).join(', ')}`
		);
	} else if (req.otherTables && req.otherTables.length > 0) {
		// No single "main" table for this cell (e.g. a free-form SQL/PRQL cell) — just list
		// what's available so the model doesn't invent table/column names.
		const tableLines = req.otherTables
			.map(
				(t) =>
					`TABLE: ${t.name}\n${t.columns.map((c, i) => `  ${quoteIdent(c)} (${t.columnTypes[i] ?? 'text'})`).join('\n')}`
			)
			.join('\n\n');
		parts.push('', 'Available tables:', tableLines);
	}
	parts.push('', 'Return JSON with "code" and "reasoning" fields.');
	return parts.join('\n');
}

export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<EditCellRequest>;
	try {
		body = (await request.json()) as Partial<EditCellRequest>;
	} catch {
		return json({ error: 'Invalid JSON request body' }, { status: 400 });
	}

	if (!body?.instruction || typeof body.instruction !== 'string' || !body.instruction.trim()) {
		return json({ error: 'instruction is required' }, { status: 400 });
	}
	if (body.cellType !== 'query' && body.cellType !== 'python') {
		return json({ error: 'cellType must be "query" or "python"' }, { status: 400 });
	}
	if (typeof body.existingCode !== 'string') {
		return json({ error: 'existingCode is required (use "" for an empty cell)' }, { status: 400 });
	}
	if (!body.llmConfig?.baseUrl?.trim() || !body.llmConfig?.model?.trim()) {
		return json({ error: 'llmConfig with baseUrl and model is required' }, { status: 400 });
	}

	const req = body as EditCellRequest;
	req.columns = Array.isArray(req.columns) ? req.columns : [];
	const controller = new AbortController();
	const timeoutMs = normalizeTimeoutMs(body.timeoutMs);
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(sc) {
			const send = (event: Record<string, unknown>) => {
				try {
					sc.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					// stream already closed
				}
			};

			try {
				const completionUrl = `${normalizeBaseUrl(req.llmConfig.baseUrl)}/chat/completions`;

				let messages: ChatMessage[];
				if (req.messages && req.messages.length > 0) {
					messages = req.messages.slice();
					for (const tr of req.toolResults ?? []) {
						messages.push({ role: 'tool', tool_call_id: tr.id, content: tr.content });
					}
					send({ type: 'status', message: 'Continuing…' });
				} else {
					messages = [
						{ role: 'system', content: buildSystemPrompt(req) },
						{ role: 'user', content: buildUserPrompt(req) }
					];
					send({ type: 'status', message: 'Generating…' });
				}

				const response = await callLLMWithTools({
					completionUrl,
					model: req.llmConfig.model,
					messages,
					tools: req.forceFinal ? undefined : READONLY_INVESTIGATION_TOOLS,
					signal: controller.signal,
					apiKey: req.llmConfig.apiKey,
					onDelta: (chunk) => send({ type: 'delta', content: chunk })
				});

				if (response.toolCalls.length > 0) {
					const assistantMessage: ChatMessage = {
						role: 'assistant',
						content: response.content,
						tool_calls: response.toolCalls.map((tc) => ({
							id: tc.id,
							type: 'function',
							function: { name: tc.name, arguments: JSON.stringify(tc.args) }
						}))
					};
					const calls: EditCellToolCall[] = response.toolCalls.map((tc) => ({
						id: tc.id,
						tool: tc.name,
						args: tc.args
					}));
					send({ type: 'tool_call', calls, messages: [...messages, assistantMessage] });
					return;
				}

				const extracted = extractEditResponse(response.content ?? '');
				if (!extracted || !extracted.code?.trim()) {
					send({ type: 'error', error: 'LLM did not produce valid code output' });
					return;
				}

				const suggestedAlternative = normalizeSuggestedAlternative(
					extracted.suggestedAlternative,
					req.cellType
				);

				let code = extracted.code.trim();
				if (req.language === 'prql') {
					code = code.replace(/`([^`]+)`/g, '"$1"').replace(/;\s*$/, '');
				} else if (req.language === 'sql') {
					code = code.replace(/;\s*$/, '');
				}

				send({
					type: 'result',
					code,
					cellType: req.cellType,
					language: req.language,
					reasoning: extracted.reasoning,
					...(suggestedAlternative && { suggestedAlternative }),
					messages: [...messages, { role: 'assistant', content: response.content }]
				});
			} catch (err) {
				const errMsg =
					err instanceof Error && err.name === 'AbortError'
						? 'AI request timed out — the model took too long to respond'
						: err instanceof Error
							? err.message
							: 'Internal error';
				send({ type: 'error', error: errMsg });
			} finally {
				clearTimeout(timeout);
				try {
					sc.close();
				} catch {
					/* already closed */
				}
			}
		},
		cancel() {
			controller.abort();
			clearTimeout(timeout);
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
