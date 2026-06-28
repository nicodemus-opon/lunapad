import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { PromptLLMConfig } from '$lib/services/prompt-llm';
import { compile as compileNodePrql, CompileOptions as NodeCompileOptions } from 'prqlc/dist/node/prqlc_js';
import {
	normalizeTimeoutMs,
	normalizeBaseUrl,
	quoteIdent as quotePrqlIdent,
	buildSchemaBlock,
	rankColumnsByRelevance,
	callLLMJson
} from '$lib/server/ai-schema-context';

export interface GeneratePRQLRequest {
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
		minVal?: string;
		maxVal?: string;
		p50Val?: string;
		dateGranularity?: string;
		topValues?: Array<{ v: string; pct: number }>;
	}>;
	/** Other tables loaded in the session — useful for join suggestions */
	otherTables?: Array<{
		name: string;
		columns: string[];
		columnTypes: string[];
	}>;
	llmConfig: PromptLLMConfig;
	timeoutMs?: number;
}

export interface GeneratePRQLResponse {
	prql: string;
	reasoning?: string;
	error?: string;
}

function extractPRQLFromResponse(content: string): { prql: string; reasoning?: string } | null {
	const fencedBlocks: string[] = [];
	const fenceRe = /```[a-z]*\s*([\s\S]+?)```/gi;
	let fenceMatch: RegExpExecArray | null;
	while ((fenceMatch = fenceRe.exec(content)) !== null) {
		fencedBlocks.push(fenceMatch[1].trim());
	}

	if (content.includes('{') && content.includes('}')) {
		const bare = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1).trim();
		fencedBlocks.push(bare);
	}

	for (const candidate of fencedBlocks) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			if (typeof parsed.prql === 'string' && parsed.prql.trim()) {
				return {
					prql: parsed.prql.trim(),
					reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : undefined
				};
			}
		} catch {
			// try next
		}
	}

	const prqlBlock = content.match(/```(?:prql|sql)\s*([\s\S]+?)```/i)?.[1]?.trim();
	if (prqlBlock && !prqlBlock.startsWith('{')) {
		return { prql: prqlBlock };
	}

	const reasoningMatch = content.match(/reasoning[:\s]+([\s\S]+?)(?=\n(?:filter|derive|group|window|sort|take|join|select)|$)/i)?.[1]?.trim();

	const prqlKeywords = /^(filter|derive|group|window|sort|take|join|select|append)\b/;
	const lines = content.split('\n');
	const prqlLines: string[] = [];
	let inPrql = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (prqlKeywords.test(trimmed)) inPrql = true;
		if (inPrql && trimmed.length > 0) prqlLines.push(line);
	}
	if (prqlLines.length > 0) {
		return {
			prql: prqlLines.join('\n').trim(),
			reasoning: reasoningMatch
		};
	}

	return null;
}

function stripLeadingFromClause(prql: string, sourceTable: string): string {
	const lines = prql.split('\n');
	const firstContentLine = lines.findIndex((l) => l.trim().length > 0);
	if (firstContentLine === -1) return prql;

	const firstLine = lines[firstContentLine].trim().toLowerCase();
	const tableNameLower = sourceTable.toLowerCase().replace(/[^a-z0-9_]/g, '');

	if (
		firstLine.startsWith('from ') &&
		(firstLine.includes(tableNameLower) || firstLine === `from ${tableNameLower}`)
	) {
		const rest = lines.slice(firstContentLine + 1).join('\n').trim();
		return rest;
	}

	return prql;
}

/** PRQL-specific cast guidance (s-string syntax) — passed to the shared buildSchemaBlock,
 *  which otherwise defaults to a generic, language-agnostic cast hint. */
function prqlCastNote(dataKind: string, sqlType: string | undefined): string | null {
	if (!sqlType) return null;
	const sql = sqlType.toUpperCase();
	if (dataKind === 'date' && (sql.includes('VARCHAR') || sql.includes('TEXT') || sql.includes('CHAR'))) {
		return 'stored as text — cast with ::date or CAST({col} AS DATE) inside s"..."';
	}
	if (dataKind === 'date' && sql.includes('TIMESTAMP')) {
		return 'timestamp — use ::date inside s"..." for date-only comparison';
	}
	if (dataKind === 'numeric' && (sql.includes('VARCHAR') || sql.includes('TEXT') || sql.includes('CHAR'))) {
		return 'stored as text — cast with CAST({col} AS DOUBLE) inside s"..."';
	}
	return null;
}

/** Build a single concrete example from the actual schema to ground the model. */
function buildDynamicExample(
	sourceTable: string,
	columns: GeneratePRQLRequest['columns']
): string {
	const numericCol = columns.find((c) => c.dataKind === 'numeric');
	const groupCol = columns.find((c) => c.dataKind === 'text' && c !== numericCol);
	const dateCol = columns.find((c) => c.dataKind === 'date');

	if (numericCol && groupCol) {
		const g = quotePrqlIdent(groupCol.name);
		const n = quotePrqlIdent(numericCol.name);
		return `Example for ${sourceTable}:\nQ: total ${numericCol.name} by ${groupCol.name}\nA: {"prql": "group {${g}} (aggregate {total = sum ${n}})\\nsort {-total}", "reasoning": "Group by ${groupCol.name}, sum ${numericCol.name}"}`;
	}
	if (dateCol && numericCol) {
		const d = quotePrqlIdent(dateCol.name);
		const n = quotePrqlIdent(numericCol.name);
		return `Example for ${sourceTable}:\nQ: monthly trend of ${numericCol.name}\nA: {"prql": "derive month = s\\"date_trunc('month', {${d}}::timestamp)\\"\\ngroup {month} (aggregate {total = sum ${n}})\\nsort {month}", "reasoning": "Truncate date to month, group and sum"}`;
	}
	return '';
}

function buildSystemPrompt(sourceTable: string, columns: GeneratePRQLRequest['columns']): string {
	const allColNames = columns.map((c) => quotePrqlIdent(c.name)).join(', ');
	const dynamicExample = buildDynamicExample(sourceTable, columns);

	return `You are a PRQL code generator. PRQL compiles to SQL. Output ONLY valid JSON: {"prql": "...", "reasoning": "..."}

CRITICAL: Use ONLY these exact column names: ${allColNames}
Using any other column name will cause a compile error.

RULES:
- prql must NOT start with "from" or "let"; use \\n for newlines in the JSON string
- Use exact column names from the schema — no invented names, no aliases
- Column names with spaces or special chars: backtick-quoted → \`col name\`
- Booleans: filter col == true / filter col == false
- count this = row count; sum col = column sum
- For numeric arithmetic (multiply, divide, add): use direct PRQL, NOT s-strings
  GOOD: derive revenue = \`Price (GHS)\` * \`Units Sold\`
  BAD:  derive revenue = s"CAST(...) * ..."  ← unnecessary for already-numeric columns
- s"..." only for SQL functions: date_trunc, CASE WHEN, window functions, NULLIF, current_date, interval
- Inside s"...": reference columns with {col} (simple names) or "{col name}" (spaced names)

TYPE CASTING — if the schema shows "⚠ stored as text" or "sql:VARCHAR" for a date/numeric column, wrap comparisons in s-strings with explicit casts:
  filter application_deadline >= s"CAST({application_deadline} AS DATE)"  ← text column cast to date
  derive n = s"CAST({amount_text} AS DOUBLE)"                              ← text column cast to numeric

NO SQL KEYWORDS — PRQL is NOT SQL:
  BAD: WHERE col > 0                  GOOD: filter col > 0
  BAD: col BETWEEN x AND y            GOOD: filter (col >= x && col <= y)
  BAD: col AND col2                   GOOD: filter col && col2  (use && not AND/OR)
  BAD: col > current_date - 30 days   GOOD: filter col > s"current_date - interval '30 days'"
  BAD: col < NOW()                    GOOD: filter col < s"current_date"

DATE FILTERS — always use s-strings for current_date and interval arithmetic:
  filter (deadline >= s"current_date" && deadline <= s"current_date + interval '30 days'")
  filter (created_at >= s"current_date - interval '7 days'" && created_at <= s"current_date")
  filter due_date >= @2024-01-01   ← PRQL date literal, only for static dates

STAGES:
  filter \`Col\` > 0 && flag == true
  derive revenue = \`Price (GHS)\` * \`Units Sold\`
  derive ratio = s"CAST({a} AS DOUBLE) / NULLIF({b}, 0)"
  derive month = s"date_trunc('month', {dt}::timestamp)"
  derive bucket = s"CASE WHEN {col} > 0 THEN 'pos' ELSE 'neg' END"
  derive roll = s"AVG({v}) OVER (PARTITION BY {g} ORDER BY {d} ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)"
  group {col, \`col name\`} (aggregate {n = count this, tot = sum \`col name\`, avg = average val})
  sort {-tot}
  take 10
  select {col, \`col name\`, tot}

EXAMPLES:

Q: Revenue by location and customer type
Schema: \`Price (GHS)\`(numeric), \`Units Sold\`(numeric), Location(text), \`Customer Type\`(text)
A: {"prql": "derive revenue = \`Price (GHS)\` * \`Units Sold\`\\ngroup {Location, \`Customer Type\`} (aggregate {total_revenue = sum revenue, total_units = sum \`Units Sold\`})\\nsort {-total_revenue}", "reasoning": "Direct PRQL multiply for numeric cols, backtick-quote spaced names"}

Q: Monthly sales by region, top 5
Schema: sale_date(date), region(text), amount(numeric)
A: {"prql": "derive month = s\\"date_trunc('month', {sale_date}::timestamp)\\"\\ngroup {region, month} (aggregate {total = sum amount})\\nsort {-total}\\ntake 5", "reasoning": "s-string for date_trunc SQL function, group and sum"}

Q: QA pass rate by shift
Schema: operator_shift(text), qa_passed(boolean)
A: {"prql": "derive p = s\\"CASE WHEN {qa_passed} THEN 1 ELSE 0 END\\"\\ngroup {operator_shift} (aggregate {pass_rate = average p, n = count this})\\nsort {-pass_rate}", "reasoning": "Boolean to int via CASE WHEN, group by shift"}

Q: filter where application_deadline is in the next 30 days or today
Schema: application_deadline(date)
A: {"prql": "filter (application_deadline >= s\\"current_date\\" && application_deadline <= s\\"current_date + interval '30 days'\\")", "reasoning": "s-string for current_date and interval arithmetic; PRQL && not SQL BETWEEN/AND"}
${dynamicExample ? `\n${dynamicExample}` : ''}`;
}

function buildUserPrompt(request: GeneratePRQLRequest): string {
	const relevantColumns = rankColumnsByRelevance(request.query, request.columns);
	return [
		`Question: ${request.query}`,
		'',
		'Schema:',
		buildSchemaBlock(request.sourceTable, relevantColumns, request.otherTables, prqlCastNote),
		'',
		`The query pipeline starts with: from ${request.sourceTable}`,
		'Generate the PRQL continuation stages that answer the question precisely and completely.',
		'Return JSON with "prql" and "reasoning" fields.',
		`Remember: ONLY use column names from this list: ${relevantColumns.map((c) => quotePrqlIdent(c.name)).join(', ')}`
	].join('\n');
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

function postProcessPRQL(prql: string, sourceTable: string, columns: GeneratePRQLRequest['columns'], otherTables?: GeneratePRQLRequest['otherTables']): string {
	let result = prql
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\bavg\s*\(/g, 'average (')
		.replace(/\bCOUNT\s*\(\s*\*\s*\)/g, 'count this')
		.replace(/\bcount\s*\(\s*\*\s*\)/g, 'count this');

	// Convert SQL WHERE → PRQL filter (before BETWEEN check so we can match on filter keyword)
	result = result.replace(/^\s*where\s+/gim, 'filter ');

	// Convert SQL BETWEEN x AND y → PRQL (col >= x && col <= y)
	result = result.replace(
		/\bfilter\s+([^\n]+?)\s+between\s+\(?([^)\n]+?)\)?\s+and\s+\(?([^)\n]+?)\)?(\s*$|\n)/gim,
		(_, col, lower, upper, tail) =>
			`filter (${col.trim()} >= ${lower.trim()} && ${col.trim()} <= ${upper.trim()})${tail}`
	);

	// Convert SQL AND/OR connectors in filter lines → PRQL &&/||
	// Only apply to lines starting with filter to avoid clobbering aggregate blocks
	result = result.replace(/^(filter\s+.+?)(\bAND\b)(.+)/gim, '$1&&$3');
	result = result.replace(/^(filter\s+.+?)(\bOR\b)(.+)/gim, '$1||$3');

	const hasSqlJoin = /\bjoin\s+\w+\s+(as\s+\w+\s+)?on\b/i.test(result);
	const hasSqlWhere = /^\s*where\b/im.test(result);
	if (hasSqlJoin || hasSqlWhere) {
		const prqlCompatibleKeywords = /^(filter|derive|group|window|sort|take|select|append|join\s+side:)\b/;
		const cleanedLines = result.split('\n').filter((line) => prqlCompatibleKeywords.test(line.trim()));
		if (cleanedLines.length > 0) result = cleanedLines.join('\n');
	}

	result = stripLeadingFromClause(result, sourceTable);

	const specialCols = columns.map((c) => c.name).filter((n) => /[^A-Za-z0-9_.]/.test(n));
	if (specialCols.length > 0) {
		result = result.replace(
			/s("""[\s\S]*?"""|"(?:[^"\\]|\\.)*")/g,
			(sstr) => {
				for (const col of specialCols) {
					const esc = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					sstr = sstr.replace(new RegExp('[{`}]*' + esc + '[{`}]*', 'g'), `"${col}"`);
				}
				return sstr;
			}
		);
	}

	const allSchemaColumns = [
		...columns.map((c) => c.name),
		...(otherTables ?? []).flatMap((t) => t.columns)
	];
	for (const colName of allSchemaColumns) {
		if (!/[^A-Za-z0-9_.]/.test(colName)) continue;
		const escaped = colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		result = result.replace(
			new RegExp(`(?<!['\`\\w])${escaped}(?!['\`\\w])`, 'g'),
			`\`${colName}\``
		);
	}

	return result;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<GeneratePRQLRequest>;
	try {
		body = (await request.json()) as Partial<GeneratePRQLRequest>;
	} catch {
		return json({ error: 'Invalid JSON request body' }, { status: 400 });
	}

	if (!body?.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
		return json({ error: 'query is required' }, { status: 400 });
	}
	if (!body.sourceTable || typeof body.sourceTable !== 'string') {
		return json({ error: 'sourceTable is required' }, { status: 400 });
	}
	if (!Array.isArray(body.columns) || body.columns.length === 0) {
		return json({ error: 'columns must be a non-empty array' }, { status: 400 });
	}
	if (!body.llmConfig?.baseUrl?.trim() || !body.llmConfig?.model?.trim()) {
		return json({ error: 'llmConfig with baseUrl and model is required' }, { status: 400 });
	}

	const req = body as GeneratePRQLRequest;
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
					// Stream already closed — ignore
				}
			};

			try {
				const completionUrl = `${normalizeBaseUrl(req.llmConfig.baseUrl)}/chat/completions`;
				const systemPrompt = buildSystemPrompt(req.sourceTable, req.columns);
				const userPrompt = buildUserPrompt(req);

				send({ type: 'status', message: 'Generating PRQL…' });
				const firstContent = await callLLMJson({
					completionUrl,
					model: req.llmConfig.model,
					systemPrompt,
					userPrompt,
					signal: controller.signal
				});

				const firstExtracted = extractPRQLFromResponse(firstContent);
				if (!firstExtracted || !firstExtracted.prql.trim()) {
					send({ type: 'error', error: 'LLM did not produce valid PRQL output' });
					return;
				}

				send({ type: 'status', message: 'Validating output…' });
				const firstPrql = postProcessPRQL(firstExtracted.prql, req.sourceTable, req.columns, req.otherTables);

				if (firstPrql.trim()) {
					const firstCompileError = tryCompilePRQL(req.sourceTable, firstPrql);
					if (!firstCompileError) {
						send({ type: 'result', prql: firstPrql, reasoning: firstExtracted.reasoning });
						return;
					}

					send({ type: 'status', message: 'Fixing issues, retrying…' });
					const repairUserPrompt = [
						userPrompt,
						'',
						`Previous attempt failed PRQL compilation with: ${firstCompileError}`,
						`Previous PRQL was:\n${firstPrql}`,
						'Fix the error and return corrected JSON only.'
					].join('\n');

					const repairContent = await callLLMJson({
						completionUrl,
						model: req.llmConfig.model,
						systemPrompt,
						userPrompt: repairUserPrompt,
						signal: controller.signal
					});

					const repairExtracted = extractPRQLFromResponse(repairContent);
					if (!repairExtracted || !repairExtracted.prql.trim()) {
						// Return first attempt even with compile errors — better than nothing
						send({ type: 'result', prql: firstPrql, reasoning: firstExtracted.reasoning });
						return;
					}

					send({ type: 'status', message: 'Validating output…' });
					const repairedPrql = postProcessPRQL(repairExtracted.prql, req.sourceTable, req.columns, req.otherTables);
					if (!repairedPrql.trim()) {
						send({ type: 'result', prql: firstPrql, reasoning: firstExtracted.reasoning });
						return;
					}

					const repairCompileError = tryCompilePRQL(req.sourceTable, repairedPrql);
					if (!repairCompileError) {
						send({ type: 'result', prql: repairedPrql, reasoning: repairExtracted.reasoning });
					} else {
						send({
							type: 'result',
							prql: repairedPrql,
							reasoning: `${repairExtracted.reasoning ?? ''} (note: may need manual fixes — ${repairCompileError})`.trim()
						});
					}
				} else {
					send({ type: 'error', error: 'Generated PRQL was empty after post-processing' });
				}
			} catch (err) {
				if (!(err instanceof Error && err.name === 'AbortError')) {
					send({ type: 'error', error: err instanceof Error ? err.message : 'Internal error' });
				}
				// AbortError: client disconnected — don't send anything
			} finally {
				clearTimeout(timeout);
				try { sc.close(); } catch { /* already closed */ }
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
			'Connection': 'keep-alive'
		}
	});
};
