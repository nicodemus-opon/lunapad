import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	generatePromptStagePlanFromSuggestion,
	type ExternalPromptStageSuggestionInput
} from '$lib/services/stage-catalog';
import type { LLMPlanningContext } from '$lib/services/intelligence-db';
import type { PromptLLMConfig } from '$lib/services/prompt-llm';

interface PromptStagePlanRequest {
	query: string;
	availableColumns: string[];
	llmContext?: LLMPlanningContext;
	llmConfig: PromptLLMConfig;
	timeoutMs?: number;
}

interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_CONTEXT_COLUMNS = 24;
const GENERIC_REASON_PATTERN = /(llm|generated|stage chain|pipeline|analysis|insight|optimiz|improv|efficient|useful|helpful)/i;
const GENERIC_LABEL_PATTERN = /^(analysis|query|insight|report|generated|llm|plan|stage)(\b|\s|:|-)/i;

function normalizeTimeoutMs(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
	return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(value)));
}

function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	if (/\/v\d+$/i.test(trimmed)) return trimmed;
	return `${trimmed}/v1`;
}

function extractFirstJSONObject(value: string): string | null {
	const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
	if (fenced) return fenced;

	const start = value.indexOf('{');
	const end = value.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) return null;
	return value.slice(start, end + 1);
}

function pickConcreteFallbackReason(query: string, availableColumns: string[]): string {
	const firstColumn = availableColumns.find((column) => typeof column === 'string' && column.trim().length > 0);
	if (firstColumn) {
		return `Aligns with \"${query}\" using ${firstColumn}`;
	}
	return `Aligns with \"${query}\"`;
}

function sanitizeSuggestion(
	value: unknown,
	context: { query: string; availableColumns: string[] }
): ExternalPromptStageSuggestionInput | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ExternalPromptStageSuggestionInput>;
	if (typeof candidate.label !== 'string' || candidate.label.trim().length === 0) return null;
	if (!Array.isArray(candidate.stages) || candidate.stages.length === 0) return null;

	const filteredReasons = Array.isArray(candidate.reasons)
		? candidate.reasons
				.filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0)
				.map((reason) => reason.trim())
				.filter((reason) => !GENERIC_REASON_PATTERN.test(reason) || reason.length > 40)
				.slice(0, 5)
		: [];

	const reasons = filteredReasons.length > 0
		? filteredReasons
		: [pickConcreteFallbackReason(context.query, context.availableColumns)];

	const rawLabel = candidate.label.trim();
	const label = GENERIC_LABEL_PATTERN.test(rawLabel)
		? `Plan: ${context.query.slice(0, 72)}`
		: rawLabel;

	return {
		label,
		prompt: typeof candidate.prompt === 'string' && candidate.prompt.trim().length > 0
			? candidate.prompt.trim()
			: `${label} for ${context.query}`,
		reasons,
		stages: candidate.stages as ExternalPromptStageSuggestionInput['stages'],
		score: typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? candidate.score : 130,
		confidence: typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence) ? candidate.confidence : 0.74
	};
}

/** Score a column's relevance to the query: word overlap + semantic type + grouping cardinality + null penalty. */
function columnRelevanceScore(
	query: string,
	columnName: string,
	semanticType: string | undefined,
	nullRatio: number,
	distinctCount: number
): number {
	const queryTokens = new Set(
		query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
	);
	const colTokens = columnName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
	const nameOverlap = colTokens.filter((t) => queryTokens.has(t)).length;
	const semanticBoost = semanticType && queryTokens.has(semanticType.toLowerCase()) ? 1 : 0;

	// Boost categorical columns (suitable for grouping) when the query implies grouping/segmentation
	const isGroupingQuery = /(group|by|per|each|breakdown|segment|categor|type|top\s*\d|rank)/i.test(query);
	const distinctBoost = isGroupingQuery && distinctCount > 3 && distinctCount < 500 ? 0.5 : 0;

	// Penalise columns that are mostly empty — less analytically useful
	const nullPenalty = nullRatio > 0.5 ? -0.5 : nullRatio > 0.3 ? -0.25 : 0;

	return nameOverlap + semanticBoost + distinctBoost + nullPenalty;
}

function buildContextBlock(
	query: string,
	llmContext: LLMPlanningContext | undefined
): string {
	if (!llmContext || !Array.isArray(llmContext.columns) || llmContext.columns.length === 0) {
		return 'schemaContext: none';
	}

	// Rank columns by relevance to query, then fall back to original order for ties
	const ranked = llmContext.columns
		.map((column, idx) => ({
			column,
			idx,
			score: columnRelevanceScore(
				query,
				column.name,
				column.semanticType ?? undefined,
				Number(column.nullRatio ?? 0),
				Number(column.distinctCount ?? 0)
			)
		}))
		.sort((a, b) => b.score - a.score || a.idx - b.idx)
		.slice(0, MAX_CONTEXT_COLUMNS);

	const compactColumns = ranked.map(({ column }) => {
		// Prefer frequency-ranked top values; fall back to random samples
		const samples = (column.topValues?.slice(0, 4).map((t) => t.v))
			?? (column.sampleValues ?? []).slice(0, 4);

		const col: Record<string, unknown> = {
			name: column.name,
			kind: column.dataKind,
			semantic: column.semanticType ?? 'text',
			semanticConfidence: Number(column.semanticConfidence ?? 0),
			nullRatio: Number(column.nullRatio ?? 0),
			distinctCount: Number(column.distinctCount ?? 0),
			sampleValues: samples
		};

		if (column.minVal != null && column.maxVal != null) {
			col.range = `${column.minVal}–${column.maxVal}`;
		}
		if (column.p50Val != null) col.median = column.p50Val;
		if (column.dateGranularity) col.dateGranularity = column.dateGranularity;
		if (column.topValues && column.topValues.length > 0) {
			col.topValues = column.topValues.slice(0, 6).map((t) => ({
				v: t.v,
				pct: Math.round(t.pct * 100)
			}));
		}

		return col;
	});

	return [
		`sourceTable: ${llmContext.sourceTable ?? 'unknown'}`,
		`pipelineStageTypes: ${JSON.stringify((llmContext.pipelineStageTypes ?? []).slice(0, 12))}`,
		`columnContext: ${JSON.stringify(compactColumns)}`
	].join('\n');
}

function buildPrompt(input: {
	query: string;
	availableColumns: string[];
	llmContext?: LLMPlanningContext;
	repairIssues?: string[];
	previousSuggestion?: ExternalPromptStageSuggestionInput | null;
}): string {
	const repairIssues = input.repairIssues ?? [];
	const repairSection = repairIssues.length > 0
		? [
			'',
			'Repair instructions:',
			`- Prior output failed validation with issues: ${JSON.stringify(repairIssues.slice(0, 8))}`,
			'- Fix invalid columns/expressions and return only corrected JSON.'
		]
		: [];
	const previousSection = input.previousSuggestion
		? [
			'',
			`previousSuggestion: ${JSON.stringify(input.previousSuggestion)}`
		]
		: [];

	// Put the column list prominently at the top of rules
	const columnList = JSON.stringify(input.availableColumns);

	return [
		'You are a PRQL GUI stage planner.',
		'Convert natural-language user questions into a compact but specific stage chain that can be applied after an existing from-stage.',
		'Return only JSON matching this shape:',
		'{"label":"...","prompt":"...","reasons":["..."],"score":130,"confidence":0.75,"stages":[...]}',
		'Rules:',
		`- FORBIDDEN: any column not in this exact list: ${columnList}`,
		'- Use only columns from the availableColumns list. Using unlisted columns will cause validation failure.',
		'- Ground column choice on schemaContext semantics and sample values when present.',
		'- Map non-technical language to analytical operators (time filters, segment grouping, ranking, trend comparison).',
		'- Prefer concise, executable stages with concrete semantics (avoid generic placeholders).',
		'- Make label and reasons query-specific; avoid generic wording like "analysis", "insight", or "generated plan".',
		'- Include at least one concrete column mention in reasons when possible.',
		'- For ranking intents like top/highest/least/lowest, include group + sort + take.',
		'- Use sort ascending for least/lowest/min intents; descending for top/highest/max.',
		'- Never include a from-stage in the output stages.',
		'- Use GUI aggregation function names: sum, avg, average, count, min, max, count_distinct.',
		'- If metric-like columns exist, avoid lazy count-only plans unless user explicitly asks for row counts.',
		'- Prefer plans that reveal meaningful structure (time rollups, segment comparisons, ranking, anomaly surfacing).',
		'- Output must pass validation with no unknown columns and no compile issues.',
		'',
		'Few-shot intent translations:',
		'- "who did i pay the most in january" => filter month/january + group by payee/vendor + sum outflow/paid metric + sort desc + take.',
		'- "show where money leaks each month" => derive/choose monthly period + aggregate outflow by payee/category + rank high leakage.',
		'- "which vendors are becoming expensive lately" => compare recent periods by vendor and rank by growth delta or recent increase.',
		'',
		`query: ${input.query}`,
		`availableColumns: ${columnList}`,
		`schemaContext:\n${buildContextBlock(input.query, input.llmContext)}`,
		...previousSection,
		...repairSection
	].join('\n');
}

function validateSuggestion(
	query: string,
	availableColumns: string[],
	suggestion: ExternalPromptStageSuggestionInput
): { valid: boolean; issues: string[] } {
	const plan = generatePromptStagePlanFromSuggestion({
		query,
		availableColumns,
		suggestion,
		validateCompile: false
	});

	if (!plan) {
		return { valid: false, issues: ['suggestion could not be converted into a prompt stage plan'] };
	}

	const issues = [
		...plan.validation.issues,
		...(plan.validation.unknownColumns.length > 0
			? [`unknown columns: ${plan.validation.unknownColumns.join(', ')}`]
			: [])
	].slice(0, 10);

	return {
		valid: plan.validation.unknownColumns.length === 0 && plan.validation.issues.length === 0 && plan.stages.length > 0,
		issues
	};
}

async function requestSuggestionFromLLM(input: {
	completionUrl: string;
	llmConfig: PromptLLMConfig;
	prompt: string;
	signal: AbortSignal;
	context: { query: string; availableColumns: string[] };
}): Promise<ExternalPromptStageSuggestionInput> {
	const response = await fetch(input.completionUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: input.llmConfig.model,
			temperature: 0.2,
			top_p: 0.9,
			frequency_penalty: 0.1,
			presence_penalty: 0.0,
			stream: false,
			response_format: { type: 'json_object' },
			messages: [
				{
					role: 'system',
					content: 'Return strict JSON only. No markdown. Produce concrete, non-generic labels and reasons tied to the user query and columns.'
				},
				{
					role: 'user',
					content: input.prompt
				}
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
	if (!content) {
		throw new Error('LLM response did not include content.');
	}

	const maybeJson = extractFirstJSONObject(content);
	if (!maybeJson) {
		throw new Error('LLM response did not contain valid JSON.');
	}

	const parsed = JSON.parse(maybeJson) as unknown;
	const suggestion = sanitizeSuggestion(parsed, input.context);
	if (!suggestion) {
		throw new Error('LLM response JSON was missing required suggestion fields.');
	}

	return suggestion;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as Partial<PromptStagePlanRequest>;
		if (!body?.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
			return json({ error: 'Query is required.' }, { status: 400 });
		}
		if (!Array.isArray(body.availableColumns) || body.availableColumns.length === 0) {
			return json({ error: 'availableColumns must be a non-empty array.' }, { status: 400 });
		}
		if (!body.llmConfig || typeof body.llmConfig !== 'object') {
			return json({ error: 'llmConfig is required.' }, { status: 400 });
		}

		const llmConfig = body.llmConfig as PromptLLMConfig;
		if (!llmConfig.baseUrl?.trim() || !llmConfig.model?.trim()) {
			return json({ error: 'LLM base URL and model are required.' }, { status: 400 });
		}

		const controller = new AbortController();
		const timeoutMs = normalizeTimeoutMs(body.timeoutMs);
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const completionUrl = `${normalizeBaseUrl(llmConfig.baseUrl)}/chat/completions`;
			const query = body.query.trim();
			const llmContext = body.llmContext;
			const requestContext = {
				query: body.query.trim(),
				availableColumns: body.availableColumns
			};

			let firstSuggestion: ExternalPromptStageSuggestionInput | null = null;
			let firstIssues: string[] = [];
			try {
				firstSuggestion = await requestSuggestionFromLLM({
					completionUrl,
					llmConfig,
					prompt: buildPrompt({
						query,
						availableColumns: body.availableColumns,
						llmContext
					}),
					signal: controller.signal,
					context: requestContext
				});

				const firstValidation = validateSuggestion(query, body.availableColumns, firstSuggestion);
				if (firstValidation.valid) {
					return json({ suggestion: firstSuggestion });
				}
				firstIssues = firstValidation.issues;
			} catch (err) {
				firstIssues = [err instanceof Error ? err.message : 'First LLM attempt failed'];
			}

			const repairedSuggestion = await requestSuggestionFromLLM({
				completionUrl,
				llmConfig,
				prompt: buildPrompt({
					query,
					availableColumns: body.availableColumns,
					llmContext,
					repairIssues: firstIssues,
					previousSuggestion: firstSuggestion
				}),
				signal: controller.signal,
				context: requestContext
			});

			const repairedValidation = validateSuggestion(query, body.availableColumns, repairedSuggestion);
			if (repairedValidation.valid) {
				return json({ suggestion: repairedSuggestion });
			}

			return json(
				{
					error: `LLM generated plans failed validation after retry. Issues: ${[...firstIssues, ...repairedValidation.issues].slice(0, 10).join(' | ')}`
				},
				{ status: 502 }
			);
		} finally {
			clearTimeout(timeout);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to generate LLM prompt plan.';
		return json({ error: message }, { status: 500 });
	}
};
