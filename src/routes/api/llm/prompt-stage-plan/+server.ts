import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	generatePromptStagePlanFromSuggestion,
	type ExternalPromptStageSuggestionInput
} from '$lib/services/stage-catalog';
import type { LLMPlanningContext } from '$lib/services/intelligence-db';
import type { PromptLLMConfig } from '$lib/services/prompt-llm';
import { rankColumnsByRelevance } from '$lib/server/ai-schema-context.js';

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
const GENERIC_REASON_PATTERN =
	/(llm|generated|stage chain|pipeline|analysis|insight|optimiz|improv|efficient|useful|helpful)/i;
const GENERIC_LABEL_PATTERN =
	/^(analysis|query|insight|report|generated|llm|plan|stage)(\b|\s|:|-)/i;

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
	const firstColumn = availableColumns.find(
		(column) => typeof column === 'string' && column.trim().length > 0
	);
	if (firstColumn) {
		return `Aligns with \"${query}\" using ${firstColumn}`;
	}
	return `Aligns with \"${query}\"`;
}

import type { GUIPipelineStage } from '$lib/types/gui-pipeline';

const VALID_GUI_STAGE_TYPES = new Set([
	'filter',
	'select',
	'derive',
	'group',
	'sort',
	'take',
	'join',
	'append',
	'window',
	'loop'
]);

type GuiStage = Exclude<GUIPipelineStage, { type: 'raw' } | { type: 'from' }>;

/** Cloud models sometimes emit `{op:"GROUP",col:"region"}` instead of `{type:"group",by:[...]}`. */
function coerceLlmStages(stages: unknown[]): GuiStage[] {
	const result: GuiStage[] = [];
	let pendingGroup: {
		by: string[];
		aggs: Array<{ name: string; column: string; func: 'sum' | 'count' | 'average' }>;
	} | null = null;

	const flushGroup = () => {
		if (!pendingGroup || pendingGroup.by.length === 0) return;
		result.push({
			type: 'group',
			by: pendingGroup.by,
			aggregations:
				pendingGroup.aggs.length > 0
					? pendingGroup.aggs.map((a) => ({ name: a.name, column: a.column, func: a.func }))
					: [{ name: 'row_count', func: 'count', column: '' }]
		});
		pendingGroup = null;
	};

	for (const raw of stages) {
		if (!raw || typeof raw !== 'object') continue;
		const s = raw as Record<string, unknown>;

		if (typeof s.type === 'string' && VALID_GUI_STAGE_TYPES.has(s.type)) {
			flushGroup();
			result.push(s as unknown as GuiStage);
			continue;
		}

		const op = String(s.op ?? s.operation ?? '').toUpperCase();
		const col = String(s.col ?? s.column ?? s.by ?? '').trim();
		const col2 = String(s.col2 ?? s.column2 ?? '').trim();
		const asName = String(s.as ?? s.alias ?? s.name ?? '').trim();

		if (op === 'DERIVE' || (op === 'SUM' && col && col2)) {
			flushGroup();
			if (col && col2 && asName) {
				result.push({
					type: 'derive',
					columns: [
						{
							name: asName,
							expr: {
								mode: 'binary',
								op: '*',
								left: { kind: 'column', value: col },
								right: { kind: 'column', value: col2 }
							}
						}
					]
				});
			}
			continue;
		}

		if (op === 'GROUP' || op === 'GROUP_BY') {
			flushGroup();
			pendingGroup = { by: col ? [col] : [], aggs: [] };
			continue;
		}

		if (op === 'SUM' || op === 'AGG' || op === 'AGGREGATE' || op === 'COUNT') {
			const aggCol = col || col2;
			const aggName = asName || (aggCol ? `total_${aggCol}` : 'row_count');
			const aggFunc = op === 'COUNT' ? 'count' : 'sum';
			if (pendingGroup) {
				if (aggCol || op === 'COUNT') {
					pendingGroup.aggs.push({
						name: aggName,
						column: aggCol,
						func: aggFunc
					});
				}
			} else if (aggCol) {
				flushGroup();
				result.push({
					type: 'group',
					by: [],
					aggregations: [{ name: aggName, column: aggCol, func: aggFunc }]
				});
			}
			continue;
		}

		if (op === 'SORT' || op === 'ORDER' || op === 'ORDER_BY') {
			flushGroup();
			const sortCol = col || asName;
			if (sortCol) {
				result.push({
					type: 'sort',
					keys: [
						{
							column: sortCol,
							dir: s.desc === true || s.order === 'desc' ? 'desc' : 'asc'
						}
					]
				});
			}
			continue;
		}

		if (op === 'TAKE' || op === 'LIMIT') {
			flushGroup();
			const n = Number(s.count ?? s.n ?? s.limit ?? 10);
			if (Number.isFinite(n) && n > 0) {
				result.push({ type: 'take', n: Math.round(n) });
			}
			continue;
		}

		if (op === 'FILTER' || op === 'WHERE') {
			flushGroup();
			if (col) {
				result.push({
					type: 'filter',
					logic: 'and',
					conditions: [{ column: col, op: '==', value: String(s.value ?? s.val ?? '') }]
				});
			}
		}
	}

	flushGroup();
	return result;
}

/** Models sometimes emit one object with both group fields (by, aggregations) and sort fields (keys). */
function splitMergedGuiStages(stages: GuiStage[]): GuiStage[] {
	const out: GuiStage[] = [];
	for (const stage of stages) {
		const raw = stage as unknown as Record<string, unknown>;
		const by = Array.isArray(raw.by) ? (raw.by as string[]).filter(Boolean) : [];
		const aggs = Array.isArray(raw.aggregations)
			? (raw.aggregations as Extract<GuiStage, { type: 'group' }>['aggregations'])
			: [];
		const keys = Array.isArray(raw.keys)
			? (raw.keys as Extract<GuiStage, { type: 'sort' }>['keys'])
			: [];

		if (by.length > 0 && (aggs.length > 0 || keys.length > 0)) {
			out.push({
				type: 'group',
				by,
				aggregations: aggs.length > 0 ? aggs : [{ name: 'row_count', func: 'count', column: '' }]
			});
			if (keys.length > 0) {
				out.push({ type: 'sort', keys });
			}
			continue;
		}

		out.push(stage);
	}
	return out;
}

function sanitizeSuggestion(
	value: unknown,
	context: { query: string; availableColumns: string[] }
): ExternalPromptStageSuggestionInput | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ExternalPromptStageSuggestionInput>;
	if (typeof candidate.label !== 'string' || candidate.label.trim().length === 0) return null;
	const coercedStages = splitMergedGuiStages(
		coerceLlmStages(Array.isArray(candidate.stages) ? candidate.stages : [])
	);
	if (coercedStages.length === 0) return null;

	const filteredReasons = Array.isArray(candidate.reasons)
		? candidate.reasons
				.filter(
					(reason): reason is string => typeof reason === 'string' && reason.trim().length > 0
				)
				.map((reason) => reason.trim())
				.filter((reason) => !GENERIC_REASON_PATTERN.test(reason) || reason.length > 40)
				.slice(0, 5)
		: [];

	const reasons =
		filteredReasons.length > 0
			? filteredReasons
			: [pickConcreteFallbackReason(context.query, context.availableColumns)];

	const rawLabel = candidate.label.trim();
	const label = GENERIC_LABEL_PATTERN.test(rawLabel)
		? `Plan: ${context.query.slice(0, 72)}`
		: rawLabel;

	return {
		label,
		prompt:
			typeof candidate.prompt === 'string' && candidate.prompt.trim().length > 0
				? candidate.prompt.trim()
				: `${label} for ${context.query}`,
		reasons,
		stages: coercedStages as ExternalPromptStageSuggestionInput['stages'],
		score:
			typeof candidate.score === 'number' && Number.isFinite(candidate.score)
				? candidate.score
				: 130,
		confidence:
			typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
				? candidate.confidence
				: 0.74
	};
}

function buildContextBlock(query: string, llmContext: LLMPlanningContext | undefined): string {
	if (!llmContext || !Array.isArray(llmContext.columns) || llmContext.columns.length === 0) {
		return 'schemaContext: none';
	}

	// Shared with the agentic chat path and the single-table generate-prql/edit-cell endpoints —
	// previously a near-duplicate reimplementation lived in this file.
	const ranked = rankColumnsByRelevance(query, llmContext.columns, MAX_CONTEXT_COLUMNS);

	const compactColumns = ranked.map((column) => {
		// Prefer frequency-ranked top values; fall back to random samples
		const samples =
			column.topValues?.slice(0, 4).map((t) => t.v) ?? (column.sampleValues ?? []).slice(0, 4);

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
	const repairSection =
		repairIssues.length > 0
			? [
					'',
					'Repair instructions:',
					`- Prior output failed validation with issues: ${JSON.stringify(repairIssues.slice(0, 8))}`,
					'- Fix invalid columns/expressions and return only corrected JSON.'
				]
			: [];
	const previousSection = input.previousSuggestion
		? ['', `previousSuggestion: ${JSON.stringify(input.previousSuggestion)}`]
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
		'- Each stage MUST have a "type" field (filter|select|derive|group|sort|take|join|append|window|loop). Never use "op" keys.',
		'',
		'Example for "revenue by region" with columns region, quantity, unit_price:',
		'{"label":"Revenue by region","prompt":"Sum revenue per region","reasons":["Uses region, quantity, unit_price"],"score":130,"confidence":0.75,"stages":[',
		'  {"type":"derive","columns":[{"name":"revenue","expr":{"mode":"binary","op":"*","left":{"kind":"column","value":"quantity"},"right":{"kind":"column","value":"unit_price"}}}]},',
		'  {"type":"group","by":["region"],"aggregations":[{"name":"total_revenue","column":"revenue","func":"sum"}]},',
		'  {"type":"sort","keys":[{"column":"total_revenue","dir":"desc"}]}',
		']}',
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
	try {
		const plan = generatePromptStagePlanFromSuggestion({
			query,
			availableColumns,
			suggestion,
			validateCompile: false
		});

		if (!plan) {
			return {
				valid: false,
				issues: ['suggestion could not be converted into a prompt stage plan']
			};
		}

		const hardUnknown = plan.validation.unknownColumns.filter(
			(col) => !availableColumns.some((a) => a.toLowerCase() === col.toLowerCase())
		);

		const issues = [
			...plan.validation.issues,
			...(hardUnknown.length > 0 ? [`unknown columns: ${hardUnknown.join(', ')}`] : [])
		].slice(0, 10);

		return {
			valid: hardUnknown.length === 0 && plan.stages.length > 0,
			issues
		};
	} catch (err) {
		return {
			valid: false,
			issues: [err instanceof Error ? err.message : 'stage plan validation failed']
		};
	}
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
		headers: {
			'Content-Type': 'application/json',
			...(input.llmConfig.apiKey ? { Authorization: `Bearer ${input.llmConfig.apiKey}` } : {})
		},
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
					content:
						'Return strict JSON only. No markdown. Produce concrete, non-generic labels and reasons tied to the user query and columns.'
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

			const repairedValidation = validateSuggestion(
				query,
				body.availableColumns,
				repairedSuggestion
			);
			if (repairedValidation.valid) {
				return json({ suggestion: repairedSuggestion });
			}

			const fallback =
				repairedSuggestion.stages.length > 0
					? repairedSuggestion
					: firstSuggestion && firstSuggestion.stages.length > 0
						? firstSuggestion
						: null;
			if (fallback) {
				return json({
					suggestion: fallback,
					warning: `Plan validation was soft: ${[...firstIssues, ...repairedValidation.issues]
						.slice(0, 5)
						.join(' | ')}`
				});
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
