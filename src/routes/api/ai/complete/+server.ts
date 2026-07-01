import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeBaseUrl } from '$lib/server/ai-schema-context';
import { callLLMText, normalizeCompletionTimeoutMs } from '$lib/server/ai-tools';
import { PRQL_KEYWORDS, PRQL_BUILTINS } from '$lib/monaco/prql';
import { sanitizeCompletion } from './sanitize';

// Ghost-text inline completion (ghost-completions.ts on the client) — a single-shot,
// no-tool, no-streaming endpoint distinct from /api/ai/edit-cell and /api/ai/chat.
// Fired on every debounced keystroke pause, so it must stay fast: tight timeout, small
// max_tokens, plain-text response (not JSON-wrapped). Never returns an error the client
// needs to handle specially — any failure degrades to an empty completion.
//
// Small local models routinely ignore "no markdown/no explanation" instructions and wrap
// the answer in a fenced block or a one-line preamble — sanitizeCompletion() below strips
// that rather than inserting it verbatim into the user's code.

export type CompleteLanguage = 'prql' | 'sql' | 'python';

export interface CompleteRequest {
	language: CompleteLanguage;
	/** Cell code up to the cursor position, already capped client-side. */
	prefix: string;
	/** Code after the cursor (up to ~8 lines) — lets the model bridge toward existing code. */
	suffix?: string;
	/** Structured schema: "table: col(type), col(type)\n..." for prql/sql,
	 *  or a flat name list for python. Pre-grouped client-side. */
	schema?: string;
	/** SQL dialect — DuckDB, PostgreSQL, ClickHouse, MySQL, Trino. */
	dialect?: string;
	/** Only meaningful for language: 'python' — UDF cells get a different prompt/example
	 *  than data cells (fixed type-hint skeleton vs. pandas/plotly conventions). */
	pythonKind?: 'udf' | 'data';
	llmConfig: { provider: string; baseUrl: string; model: string; apiKey?: string };
	timeoutMs?: number;
}

const SHARED_INSTRUCTION =
	'Output ONLY the raw text that continues the code at the cursor — no explanation, no markdown code fences, no repeating any of the code you were given.';

function buildSystemPrompt(req: CompleteRequest): string {
	if (req.language === 'prql') {
		return `Complete this PRQL (Pipelined Relational Query Language) code. PRQL keywords: ${PRQL_KEYWORDS.join(', ')}. PRQL functions: ${PRQL_BUILTINS.join(', ')}.
Example:
Code: "from orders\\nfilter "
Completion: "status == \\"completed\\""
${SHARED_INSTRUCTION}`;
	}
	if (req.language === 'sql') {
		const dialectLabel = req.dialect ?? 'SQL';
		return `Complete this ${dialectLabel} code.
Example:
Code: "select id, name from customers where "
Completion: "status = 'active'"
Example:
Code: "select region, sum(amount) as revenue from orders group by region order by "
Completion: "revenue desc"
${SHARED_INSTRUCTION}`;
	}
	if (req.pythonKind === 'udf') {
		return `Complete this Python user-defined function. UDFs take typed scalar args and return a typed scalar value.
Example:
Code: "def "
Completion: "double(x: int) -> int:\\n    return x * 2"
${SHARED_INSTRUCTION}`;
	}
	return `Complete this Python data-analysis cell code. pandas is available as "pd", plotly.graph_objects as "go". Upstream notebook cells are already-bound pandas DataFrames, referenced by their output name. End with a bare expression or assign to "result"/"fig" to display output.
Example:
Code: "orders.groupby(\\"status\\")."
Completion: "size().reset_index(name=\\"count\\")"
${SHARED_INSTRUCTION}`;
}

function buildUserPrompt(req: CompleteRequest): string {
	const parts: string[] = [];

	if (req.schema?.trim()) {
		parts.push(`Schema:\n${req.schema}`);
	}

	if (req.suffix?.trim()) {
		parts.push(`Code before cursor:\n${req.prefix}`, `Code after cursor:\n${req.suffix}`);
	} else {
		parts.push(`Code:\n${req.prefix}`);
	}

	return parts.join('\n\n');
}

function isLowQualityCompletion(completion: string, req: CompleteRequest): boolean {
	const s = completion.trim();
	if (!s) return true;
	if (req.language === 'sql') {
		const tail = req.prefix.trim().slice(-60).toLowerCase();
		if ((tail.endsWith(',') || tail.includes('as mom_delta,')) && /^from\s+\w+$/i.test(s)) {
			return true;
		}
		if (tail.includes('select ') && /^from\s+/i.test(s) && s.length < 24) return true;
	}
	return false;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<CompleteRequest>;
	try {
		body = (await request.json()) as Partial<CompleteRequest>;
	} catch {
		return json({ completion: '' });
	}

	if (
		(body.language !== 'prql' && body.language !== 'sql' && body.language !== 'python') ||
		typeof body.prefix !== 'string' ||
		!body.llmConfig?.baseUrl?.trim() ||
		!body.llmConfig?.model?.trim()
	) {
		return json({ completion: '' });
	}

	const req = body as CompleteRequest;
	const controller = new AbortController();
	const timeoutMs = normalizeCompletionTimeoutMs(req.timeoutMs);
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const prefixTokenBudget = Math.min(220, Math.max(96, 48 + Math.floor(req.prefix.length / 4)));
		const completionUrl = `${normalizeBaseUrl(req.llmConfig.baseUrl)}/chat/completions`;
		let completion = await callLLMText({
			completionUrl,
			model: req.llmConfig.model,
			systemPrompt: buildSystemPrompt(req),
			userPrompt: buildUserPrompt(req),
			maxTokens: prefixTokenBudget,
			signal: controller.signal,
			apiKey: req.llmConfig.apiKey,
			provider: req.llmConfig.provider
		});
		let sanitized = sanitizeCompletion(completion, req.prefix, req.suffix ?? '');
		if (
			(!sanitized.trim() || isLowQualityCompletion(sanitized, req)) &&
			!controller.signal.aborted
		) {
			completion = await callLLMText({
				completionUrl,
				model: req.llmConfig.model,
				systemPrompt: buildSystemPrompt(req),
				userPrompt: `${buildUserPrompt(req)}\n\nContinue at the cursor only. Output the next tokens of the current statement — not a new FROM clause.`,
				maxTokens: Math.min(280, prefixTokenBudget + 64),
				signal: controller.signal,
				apiKey: req.llmConfig.apiKey,
				provider: req.llmConfig.provider
			});
			sanitized = sanitizeCompletion(completion, req.prefix, req.suffix ?? '');
		}
		return json({ completion: sanitized });
	} catch {
		// Timeout, network error, or malformed upstream response — ghost text is best-effort,
		// never surface this as an error the client needs to handle.
		return json({ completion: '' });
	} finally {
		clearTimeout(timeout);
	}
};
