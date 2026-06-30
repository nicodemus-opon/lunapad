import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeBaseUrl } from '$lib/server/ai-schema-context';
import { callLLMText, normalizeCompletionTimeoutMs } from '$lib/server/ai-tools';
import { PRQL_KEYWORDS, PRQL_BUILTINS } from '$lib/monaco/prql';

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

/** Strip artifacts small models add despite instructions: fenced code blocks, a leading
 *  explanatory line, and any overlap with the tail of the prefix (models often restate
 *  the last few characters before continuing). Also caps runaway-length completions. */
function sanitizeCompletion(raw: string, prefix: string): string {
	// Some reasoning models emit their chain-of-thought inline as literal <think> tags in
	// `content` rather than a separate `reasoning` field — strip it before anything else.
	let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

	const fenced = text.match(/```[a-zA-Z]*\n?([\s\S]*?)```/);
	if (fenced) text = fenced[1].trim();

	// Drop a leading prose line like "Here's the completion:" before the actual code.
	const lines = text.split('\n');
	if (lines.length > 1 && /^(here|sure|completion|continuing)\b.*:$/i.test(lines[0].trim())) {
		text = lines.slice(1).join('\n').trim();
	}

	// Remove overlap if the model restated the tail of the prefix before continuing.
	const prefixTail = prefix.slice(-40);
	for (let overlap = Math.min(prefixTail.length, text.length); overlap > 3; overlap--) {
		if (prefixTail.endsWith(text.slice(0, overlap))) {
			text = text.slice(overlap);
			break;
		}
	}

	const cappedLines = text.split('\n').slice(0, 8).join('\n');
	return cappedLines.slice(0, 500);
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
		const completionUrl = `${normalizeBaseUrl(req.llmConfig.baseUrl)}/chat/completions`;
		const completion = await callLLMText({
			completionUrl,
			model: req.llmConfig.model,
			systemPrompt: buildSystemPrompt(req),
			userPrompt: buildUserPrompt(req),
			signal: controller.signal,
			apiKey: req.llmConfig.apiKey,
			provider: req.llmConfig.provider
		});
		return json({ completion: sanitizeCompletion(completion, req.prefix) });
	} catch {
		// Timeout, network error, or malformed upstream response — ghost text is best-effort,
		// never surface this as an error the client needs to handle.
		return json({ completion: '' });
	} finally {
		clearTimeout(timeout);
	}
};
