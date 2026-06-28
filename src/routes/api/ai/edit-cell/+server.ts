import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	compile as compileNodePrql,
	CompileOptions as NodeCompileOptions
} from 'prqlc/dist/node/prqlc_js';
import {
	normalizeTimeoutMs,
	normalizeBaseUrl,
	quoteIdent,
	buildSchemaBlock,
	rankColumnsByRelevance,
	callLLMJson,
	type SchemaColumn,
	type OtherTable
} from '$lib/server/ai-schema-context';

// Fast, scoped single-turn cell edit — the inline "Tell AI what to do" prompt. Deliberately
// a sibling to /api/llm/generate-prql rather than a generalization of it: that endpoint's
// compile-validate-repair loop and PRQL-idiom postprocessing are too PRQL-specific to branch
// three ways (PRQL/SQL/Python) cleanly. Only the schema-context building is shared.

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

	return `You are editing a single ${langLabel} notebook cell in place, based on a short instruction. Output ONLY valid JSON: {"code": "...", "reasoning": "...", "suggestedAlternative"?: {...}}

The cell currently contains:
\`\`\`
${req.existingCode || '(empty)'}
\`\`\`

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

function tryCompilePRQL(sourceTable: string, prql: string): string | null {
	try {
		const fullQuery = `from ${sourceTable}\n${prql}`;
		const opts = new NodeCompileOptions();
		opts.target = 'sql.duckdb';
		opts.signature_comment = false;
		opts.format = true;
		compileNodePrql(fullQuery, opts);
		return null;
	} catch (err: unknown) {
		try {
			type ErrEntry = { reason?: string; display?: string };
			const parsed = JSON.parse((err as Error).message) as ErrEntry & { inner?: ErrEntry[] };
			const inner: ErrEntry[] = parsed.inner ?? [parsed];
			return inner.map((e) => e.reason ?? e.display ?? String(e)).join('; ');
		} catch {
			return String(err);
		}
	}
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
				const systemPrompt = buildSystemPrompt(req);
				const userPrompt = buildUserPrompt(req);

				send({ type: 'status', message: 'Generating…' });
				const content = await callLLMJson({
					completionUrl,
					model: req.llmConfig.model,
					systemPrompt,
					userPrompt,
					signal: controller.signal
				});

				const extracted = extractEditResponse(content);
				if (!extracted || !extracted.code?.trim()) {
					send({ type: 'error', error: 'LLM did not produce valid code output' });
					return;
				}

				const suggestedAlternative = normalizeSuggestedAlternative(
					extracted.suggestedAlternative,
					req.cellType
				);

				// Only PRQL has a server-side compiler available — validate/repair once.
				if (req.cellType === 'query' && req.language === 'prql' && req.sourceTable) {
					const compileError = tryCompilePRQL(req.sourceTable, extracted.code);
					if (compileError) {
						send({ type: 'status', message: 'Fixing issues, retrying…' });
						const repairPrompt = [
							userPrompt,
							'',
							`Previous attempt failed PRQL compilation with: ${compileError}`,
							`Previous code was:\n${extracted.code}`,
							'Fix the error and return corrected JSON only.'
						].join('\n');
						const repairContent = await callLLMJson({
							completionUrl,
							model: req.llmConfig.model,
							systemPrompt,
							userPrompt: repairPrompt,
							signal: controller.signal
						});
						const repaired = extractEditResponse(repairContent);
						if (repaired?.code?.trim()) {
							send({
								type: 'result',
								code: repaired.code.trim(),
								cellType: req.cellType,
								language: req.language,
								reasoning: repaired.reasoning,
								...(suggestedAlternative && { suggestedAlternative })
							});
							return;
						}
					}
				}

				send({
					type: 'result',
					code: extracted.code.trim(),
					cellType: req.cellType,
					language: req.language,
					reasoning: extracted.reasoning,
					...(suggestedAlternative && { suggestedAlternative })
				});
			} catch (err) {
				if (!(err instanceof Error && err.name === 'AbortError')) {
					send({ type: 'error', error: err instanceof Error ? err.message : 'Internal error' });
				}
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
