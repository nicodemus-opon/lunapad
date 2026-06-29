// Shared schema-context helpers for the single-turn LLM endpoints (`/api/llm/generate-prql`,
// `/api/ai/edit-cell`). These are language-agnostic — describing a table's shape to a model —
// unlike the PRQL-specific compile/postprocess logic that stays local to generate-prql.

export interface SchemaColumn {
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
}

export interface OtherTable {
	name: string;
	columns: string[];
	columnTypes: string[];
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 180_000;

export function normalizeTimeoutMs(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(value)));
}

export function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	if (/\/v\d+$/i.test(trimmed)) return trimmed;
	return `${trimmed}/v1`;
}

/** Backtick-quote identifiers with non-identifier characters. Purely informational in the
 *  schema block sent to the model — not the quoting convention of any generated code. */
export function quoteIdent(name: string): string {
	if (/[^A-Za-z0-9_.]/.test(name)) return `\`${name}\``;
	return name;
}

export function sqlTypeMismatchCast(dataKind: string, sqlType: string | undefined): string | null {
	if (!sqlType) return null;
	const sql = sqlType.toUpperCase();
	if (
		dataKind === 'date' &&
		(sql.includes('VARCHAR') || sql.includes('TEXT') || sql.includes('CHAR'))
	) {
		return 'stored as text — needs an explicit date cast';
	}
	if (dataKind === 'date' && sql.includes('TIMESTAMP')) {
		return 'timestamp — cast to date for date-only comparison';
	}
	if (
		dataKind === 'numeric' &&
		(sql.includes('VARCHAR') || sql.includes('TEXT') || sql.includes('CHAR'))
	) {
		return 'stored as text — needs an explicit numeric cast';
	}
	return null;
}

export function buildSchemaBlock(
	sourceTable: string,
	columns: SchemaColumn[],
	otherTables?: OtherTable[],
	/** Language-specific cast guidance (e.g. PRQL s-string syntax vs generic). Defaults to a
	 *  generic hint; callers needing language-specific phrasing pass their own. */
	castNoteFn: (dataKind: string, sqlType: string | undefined) => string | null = sqlTypeMismatchCast
): string {
	const colLines = columns.map((col) => {
		const typePart = `${col.dataKind}${col.semanticType ? `/${col.semanticType}` : ''}${col.sqlType ? `, sql:${col.sqlType}` : ''}`;
		const castNote = castNoteFn(col.dataKind, col.sqlType);
		const extras: string[] = [];

		if (col.minVal != null && col.maxVal != null) {
			extras.push(`range: ${col.minVal}–${col.maxVal}`);
		} else if (col.sampleValues && col.sampleValues.length > 0) {
			extras.push(
				`samples: ${col.sampleValues
					.slice(0, 4)
					.map((v) => JSON.stringify(v))
					.join(', ')}`
			);
		}

		if (col.p50Val != null) extras.push(`median: ${col.p50Val}`);
		if (col.dateGranularity) extras.push(`granularity: ${col.dateGranularity}`);

		if (col.topValues && col.topValues.length > 0) {
			const topStr = col.topValues
				.slice(0, 5)
				.map((t) => `${JSON.stringify(t.v)}(${Math.round(t.pct * 100)}%)`)
				.join(', ');
			extras.push(`top: ${topStr}`);
		}

		if (castNote) extras.unshift(`⚠ ${castNote}`);
		const detail = extras.length > 0 ? ` — ${extras.join(', ')}` : '';
		return `  ${quoteIdent(col.name)} (${typePart})${detail}`;
	});

	const mainTableBlock = [`TABLE: ${sourceTable}`, ...colLines].join('\n');

	if (!otherTables || otherTables.length === 0) return mainTableBlock;

	const otherBlocks = otherTables.map((t) => {
		const typedCols = t.columns
			.map((c, i) => `  ${quoteIdent(c)} (${t.columnTypes[i] ?? 'text'})`)
			.join('\n');
		return `TABLE: ${t.name}\n${typedCols}`;
	});

	return [mainTableBlock, ...otherBlocks].join('\n\n');
}

/** Rank columns by relevance: word overlap + semantic type + kind + distinctCount (grouping) + nullRatio penalty. */
export function rankColumnsByRelevance(
	query: string,
	columns: SchemaColumn[],
	maxColumns = 20
): SchemaColumn[] {
	if (columns.length <= maxColumns) return columns;

	const queryTokens = new Set(
		query
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/)
			.filter((t) => t.length > 1)
	);
	const isGroupingQuery = /(group|by|per|each|breakdown|segment|categor|type|top\s*\d|rank)/i.test(
		query
	);

	const scored = columns.map((col) => {
		const colTokens = col.name
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/);
		const nameOverlap = colTokens.filter((t) => queryTokens.has(t)).length;
		const semanticBoost =
			col.semanticType && queryTokens.has(col.semanticType.toLowerCase()) ? 1 : 0;
		const kindBoost = col.dataKind === 'numeric' || col.dataKind === 'date' ? 0.5 : 0;

		const distinctCount = col.distinctCount ?? 0;
		const nullRatio = col.nullRatio ?? 0;
		const distinctBoost = isGroupingQuery && distinctCount > 3 && distinctCount < 500 ? 0.5 : 0;
		const nullPenalty = nullRatio > 0.5 ? -0.5 : nullRatio > 0.3 ? -0.25 : 0;

		return { col, score: nameOverlap + semanticBoost + kindBoost + distinctBoost + nullPenalty };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, maxColumns).map((s) => s.col);
}

export interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

/** Single non-streaming chat completion call, shared by both single-turn LLM endpoints. */
export async function callLLMJson(input: {
	completionUrl: string;
	model: string;
	systemPrompt: string;
	userPrompt: string;
	signal: AbortSignal;
	apiKey?: string;
}): Promise<string> {
	const isQwen3 = /qwen3/i.test(input.model ?? '');
	const systemContent = isQwen3 ? input.systemPrompt + '\n/no_think' : input.systemPrompt;

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
			frequency_penalty: 0.0,
			presence_penalty: 0.0,
			stream: false,
			response_format: { type: 'json_object' },
			...(isQwen3 ? { options: { think: false } } : {}),
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

	const payload = (await response.json()) as OpenAIChatCompletionResponse;
	const content = payload.choices?.[0]?.message?.content ?? '';
	if (!content.trim()) throw new Error('LLM returned empty content');
	return content;
}
