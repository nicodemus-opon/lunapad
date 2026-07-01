<script lang="ts">
	import { registerStageMenu } from '$lib/keyboard/stage-bridge';
	import type { StageType, GUIPipelineStage } from '$lib/types/gui-pipeline';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		getQuickChips,
		type QuickChip,
		recommendPresets,
		searchPresets,
		searchFunctionActions,
		searchSemanticStageCombinations,
		searchAnalysisPrompts,
		generatePromptStagePlan,
		generatePromptStagePlanFromSuggestion,
		searchStages,
		makeDefaultStage,
		type StagePresetSuggestion,
		type FunctionSearchSuggestion,
		type StageSemanticFanoutSuggestion,
		type StageAnalysisPromptSuggestion,
		type PromptStageGenerationPlan
	} from '$lib/services/stage-catalog';
	import { getLLMPlanningContext } from '$lib/services/intelligence-db';
	import { getLLMConfig, getTables, getConnections } from '$lib/stores/notebook.svelte';
	import {
		inferPromptStageSuggestionWithLLM,
		generateFullPRQLWithLLM,
		cancelActiveGenerate,
		type FullPRQLGenerationResult
	} from '$lib/services/prompt-llm';
	import { fetchAndProfileExternalTable } from '$lib/services/intelligence-db';
	import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
	import {
		reconcileStageSequenceToAvailableColumns,
		prqlToGuiStages
	} from '$lib/services/gui-prql';
	import {
		ArrowUpDown,
		BarChart2,
		Calculator,
		Columns,
		Database,
		Filter,
		Hash,
		Link2,
		Plus,
		Search,
		Sparkles,
		WandSparkles
	} from '@lucide/svelte';

	type CommandResult =
		| { kind: 'stage'; type: StageType; label: string; description: string }
		| { kind: 'preset'; suggestion: StagePresetSuggestion }
		| { kind: 'function'; suggestion: FunctionSearchSuggestion }
		| { kind: 'semantic'; suggestion: StageSemanticFanoutSuggestion }
		| { kind: 'analysis'; suggestion: StageAnalysisPromptSuggestion };

	type QueryLane = {
		key: string;
		title: string;
		description: string;
		results: CommandResult[];
		startIndex: number;
	};

	type PromptGenerationMode = 'fast' | 'llm';

	interface Props {
		onAdd: (stage: GUIPipelineStage) => void;
		onAddPreset?: (stages: Exclude<GUIPipelineStage, { type: 'raw' }>[]) => void;
		stages: GUIPipelineStage[];
		availableColumns?: string[];
		availableColumnCount: number;
		connectionId?: string;
		recentUsage?: Partial<Record<StageType, number>>;
		quickChips?: QuickChip[];
		presetSuggestions?: StagePresetSuggestion[];
	}

	let {
		onAdd,
		onAddPreset,
		stages,
		availableColumns = [],
		availableColumnCount,
		connectionId = 'builtin.duckdb',
		recentUsage = {},
		quickChips: quickChipsProp = [],
		presetSuggestions: presetSuggestionsProp = []
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let showMoreStageOptions = $state(false);
	let searchRef = $state<HTMLInputElement | null>(null);
	let promptPlan = $state<PromptStageGenerationPlan | null>(null);
	let promptPlanMessage = $state<string | null>(null);
	let promptPlanSource = $state<PromptGenerationMode>('fast');
	let llmGenerating = $state(false);
	let llmFullQuery = $state<FullPRQLGenerationResult | null>(null);

	const PROMPT_AUTO_APPLY_THRESHOLD = 0.9;

	const ICONS: Record<StageType, typeof Plus> = {
		append: Plus,
		filter: Filter,
		select: Columns,
		derive: Calculator,
		group: BarChart2,
		window: Plus,
		loop: Plus,
		sort: ArrowUpDown,
		take: Hash,
		join: Link2,
		from: Database,
		raw: Plus
	};

	const quickChips = $derived(
		quickChipsProp.length > 0 ? quickChipsProp : getQuickChips({ stages, availableColumns })
	);

	const stageResults = $derived(searchStages(query));
	const functionResults = $derived(
		searchFunctionActions({
			query,
			availableColumns,
			limit: 10
		})
	);
	const semanticResults = $derived(
		searchSemanticStageCombinations({
			query,
			availableColumns,
			limit: 12
		})
	);
	const analysisResults = $derived(
		searchAnalysisPrompts({
			query,
			availableColumns,
			limit: 8
		})
	);
	const normalizedQuery = $derived(query.trim().toLowerCase());
	const llmConfig = $derived(getLLMConfig());

	const STAGE_QUERY_ALIASES: Array<{ type: StageType; aliases: string[] }> = [
		{ type: 'filter', aliases: ['filter', 'where'] },
		{ type: 'group', aliases: ['group', 'groupby', 'aggregate', 'agg'] },
		{ type: 'derive', aliases: ['derive', 'compute', 'calc', 'calculate'] },
		{ type: 'sort', aliases: ['sort', 'order', 'orderby'] },
		{ type: 'take', aliases: ['take', 'limit', 'top'] },
		{ type: 'join', aliases: ['join', 'merge'] },
		{ type: 'window', aliases: ['window', 'rolling', 'lag'] },
		{ type: 'append', aliases: ['append', 'union', 'concat'] },
		{ type: 'loop', aliases: ['loop', 'iterate'] },
		{ type: 'select', aliases: ['select', 'pick', 'columns'] },
		{ type: 'from', aliases: ['from'] }
	];
	const STAGE_INTENT_PHRASES: Array<{ type: StageType; phrase: string }> = [
		{ type: 'group', phrase: 'group by' },
		{ type: 'sort', phrase: 'order by' }
	];
	const QUERY_FILLER_TOKENS = new Set([
		'show',
		'find',
		'list',
		'please',
		'me',
		'data',
		'rows',
		'records',
		'the',
		'a',
		'an',
		'can',
		'you'
	]);

	function detectExplicitStageIntent(queryValue: string): StageType | null {
		if (!queryValue) return null;
		if (/\btop\s+\d+\b/.test(queryValue) && /\b(by|where|when|per|with)\b/.test(queryValue))
			return null;
		const queryTokens = queryValue
			.split(/\s+/g)
			.map((token) =>
				token
					.trim()
					.toLowerCase()
					.replace(/[^a-z0-9_]+/g, '')
			)
			.filter(Boolean);
		if (queryTokens.length === 0) return null;

		for (const intent of STAGE_INTENT_PHRASES) {
			if (queryValue.includes(intent.phrase)) return intent.type;
		}

		const meaningfulTokens = queryTokens.filter((token) => !QUERY_FILLER_TOKENS.has(token));
		if (meaningfulTokens.length === 0) return null;

		const earlyTokens = meaningfulTokens.slice(0, 4);
		for (const token of earlyTokens) {
			for (const mapping of STAGE_QUERY_ALIASES) {
				if (!mapping.aliases.includes(token)) continue;
				if (
					mapping.type === 'take' &&
					token === 'top' &&
					/^\d+$/.test(earlyTokens[1] ?? '') &&
					/\b(by|where|when|per|with)\b/.test(queryValue)
				) {
					return null;
				}
				return mapping.type;
			}
		}

		if (earlyTokens[0] === 'top' && earlyTokens.length > 1) {
			if (/^\d+$/.test(earlyTokens[1])) {
				if (/\b(by|where|when|per|with)\b/.test(queryValue)) return null;
				return 'take';
			}
		}

		return null;
	}

	const explicitStageIntent = $derived(detectExplicitStageIntent(normalizedQuery));
	const queryLooksAnalytical = $derived(
		(() => {
			if (!normalizedQuery) return false;
			if (/\b(group by|order by)\b/.test(normalizedQuery)) return true;
			if (
				/\b(by|trend|over time|month|monthly|year|yearly|daily|weekly|top|compare|correlation|breakdown|which|what|how many|most|least|highest|lowest|best|worst|longest|shortest|cheapest|farthest|expensive|spike|spikes|outlier|anomaly)\b/.test(
					normalizedQuery
				)
			)
				return true;
			return false;
		})()
	);
	const stageIntentResults = $derived(
		(() => {
			if (!explicitStageIntent) return stageResults;

			const directMatches = stageResults.filter((result) => result.type === explicitStageIntent);
			if (directMatches.length > 0) {
				const remaining = stageResults.filter((result) => result.type !== explicitStageIntent);
				return [...directMatches, ...remaining];
			}

			const fallback = searchStages(explicitStageIntent).find(
				(result) => result.type === explicitStageIntent
			);
			if (!fallback) return stageResults;
			return [fallback, ...stageResults.filter((result) => result.type !== explicitStageIntent)];
		})()
	);

	function normalizeToken(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '');
	}

	function matchedColumnForQuery(queryValue: string): string | null {
		if (!queryValue) return null;

		const exact = availableColumns.find((column) => column.toLowerCase() === queryValue);
		if (exact) return exact;

		const prefixed = availableColumns.find((column) => column.toLowerCase().startsWith(queryValue));
		if (prefixed) return prefixed;

		const contains = availableColumns.find((column) => column.toLowerCase().includes(queryValue));
		if (contains) return contains;

		const normalizedQueryToken = normalizeToken(queryValue);
		if (!normalizedQueryToken) return null;

		return (
			availableColumns.find((column) => normalizeToken(column).includes(normalizedQueryToken)) ??
			null
		);
	}

	const matchedColumn = $derived(matchedColumnForQuery(normalizedQuery));

	const basePresetSuggestions = $derived(
		presetSuggestionsProp.length > 0
			? presetSuggestionsProp
			: recommendPresets({
					stages,
					availableColumns,
					availableColumnCount,
					recentUsage
				})
	);

	function presetMentionsColumn(suggestion: StagePresetSuggestion, column: string | null): boolean {
		if (!column) return false;
		const snippet = suggestion.snippet?.prql ?? '';
		if (!snippet) return false;

		const loweredSnippet = snippet.toLowerCase();
		const loweredColumn = column.toLowerCase();
		const normalizedColumn = normalizeToken(column);

		return (
			loweredSnippet.includes(loweredColumn) ||
			loweredSnippet.includes(`\"${loweredColumn}\"`) ||
			loweredSnippet.includes(`\`${loweredColumn}\``) ||
			normalizeToken(loweredSnippet).includes(normalizedColumn)
		);
	}

	function queryMatchesPresetIntent(
		queryValue: string,
		suggestion: StagePresetSuggestion
	): boolean {
		if (!queryValue) return false;

		function isTemporalSuggestion(candidate: StagePresetSuggestion): boolean {
			if (candidate.hydration.semanticCategory === 'temporal') return true;
			const temporalPresetIds = new Set([
				'temporal-trend',
				'period-variance',
				'seasonal-pattern',
				'window-rolling',
				'window-lag-delta',
				'drift-monitor',
				'cohort-retention'
			]);
			if (temporalPresetIds.has(candidate.preset.id)) return true;

			const semanticText = [
				candidate.hydration.analysisPattern,
				...candidate.hydration.techniques,
				...candidate.hydration.metricHints,
				candidate.preset.label,
				candidate.preset.description
			]
				.join(' ')
				.toLowerCase();
			return /(time|temporal|period|month|date|season|rolling|lag|trend)/i.test(semanticText);
		}

		const queryLikeTemporal = /(date|time|timestamp|_at|month|year|day)/i.test(queryValue);
		if (queryLikeTemporal) {
			if (isTemporalSuggestion(suggestion)) return true;
		}

		const searchableText = [
			suggestion.preset.label,
			suggestion.preset.description,
			...suggestion.preset.keywords,
			...suggestion.reasons,
			suggestion.hydration.analysisPattern,
			...suggestion.hydration.techniques,
			suggestion.snippet?.prql ?? ''
		]
			.join(' ')
			.toLowerCase();

		return (
			searchableText.includes(queryValue) ||
			normalizeToken(searchableText).includes(normalizeToken(queryValue))
		);
	}

	const rankedPresetSuggestions = $derived(
		basePresetSuggestions.slice().sort((a, b) => {
			const aColumnMatch = presetMentionsColumn(a, matchedColumn);
			const bColumnMatch = presetMentionsColumn(b, matchedColumn);
			if (aColumnMatch !== bColumnMatch) return aColumnMatch ? -1 : 1;
			return b.score - a.score;
		})
	);

	const presetSearchIds = $derived(new Set(searchPresets(query).map((preset) => preset.id)));

	const filteredPresetSuggestions = $derived(
		(() => {
			function isTemporalSuggestion(candidate: StagePresetSuggestion): boolean {
				if (candidate.hydration.semanticCategory === 'temporal') return true;
				const temporalPresetIds = new Set([
					'temporal-trend',
					'period-variance',
					'seasonal-pattern',
					'window-rolling',
					'window-lag-delta',
					'drift-monitor',
					'cohort-retention'
				]);
				if (temporalPresetIds.has(candidate.preset.id)) return true;

				const semanticText = [
					candidate.hydration.analysisPattern,
					...candidate.hydration.techniques,
					...candidate.hydration.metricHints,
					candidate.preset.label,
					candidate.preset.description
				]
					.join(' ')
					.toLowerCase();
				return /(time|temporal|period|month|date|season|rolling|lag|trend)/i.test(semanticText);
			}

			function buildSemanticFallbackColumns(
				queryValue: string,
				matchedColumnValue: string | null
			): string[] {
				const hints = ['order_date', 'created_at', 'timestamp', 'date', 'month', 'year', 'amount'];
				const queryTokens = queryValue
					.split(/[^a-z0-9_]+/i)
					.map((token) => token.trim())
					.filter((token) => token.length > 0);
				return Array.from(
					new Set([
						...availableColumns,
						...(matchedColumnValue ? [matchedColumnValue] : []),
						...queryTokens,
						...hints
					])
				);
			}

			const fallbackRankedSuggestions = recommendPresets({
				stages,
				availableColumns,
				availableColumnCount,
				recentUsage
			});

			const semanticFallbackColumns = buildSemanticFallbackColumns(normalizedQuery, matchedColumn);
			const semanticFallbackSuggestions = recommendPresets({
				stages,
				availableColumns: semanticFallbackColumns,
				availableColumnCount: Math.max(availableColumnCount, semanticFallbackColumns.length),
				recentUsage
			});
			const suggestionPool =
				rankedPresetSuggestions.length > 0 ? rankedPresetSuggestions : fallbackRankedSuggestions;

			if (normalizedQuery.length === 0) return suggestionPool;

			const matched = suggestionPool.filter((suggestion) => {
				if (presetSearchIds.has(suggestion.preset.id)) return true;
				if (presetMentionsColumn(suggestion, matchedColumn)) return true;
				return queryMatchesPresetIntent(normalizedQuery, suggestion);
			});

			if (matched.length > 0) return matched;

			if (presetSearchIds.size > 0) {
				const semanticBySearchId = semanticFallbackSuggestions.filter((suggestion) =>
					presetSearchIds.has(suggestion.preset.id)
				);
				if (semanticBySearchId.length > 0) return semanticBySearchId;
			}

			const queryLikeTemporal = /(date|time|timestamp|_at|month|year|day)/i.test(normalizedQuery);
			if (!queryLikeTemporal) return matched;

			const temporalMatches = suggestionPool.filter((suggestion) =>
				isTemporalSuggestion(suggestion)
			);
			if (temporalMatches.length > 0) return temporalMatches;

			return semanticFallbackSuggestions.filter((suggestion) => isTemporalSuggestion(suggestion));
		})()
	);

	const queryLanes = $derived(
		(() => {
			if (normalizedQuery.length === 0) return [] as QueryLane[];

			const stageLane: Omit<QueryLane, 'startIndex'> = {
				key: 'stages',
				title: 'Stage primitives',
				description: 'Raw stage types that match your search.',
				results: stageIntentResults.map(
					(stage): CommandResult => ({
						kind: 'stage',
						type: stage.type,
						label: stage.label,
						description: stage.description
					})
				)
			};

			const semanticLane: Omit<QueryLane, 'startIndex'> = {
				key: 'semantic',
				title: 'Semantic combinations',
				description: 'Typed stage names expanded across semantic columns.',
				results: semanticResults.map(
					(suggestion): CommandResult => ({
						kind: 'semantic',
						suggestion
					})
				)
			};

			const analysisLane: Omit<QueryLane, 'startIndex'> = {
				key: 'analysis',
				title: 'Analysis prompts',
				description: 'Likely questions for this schema, translated into stage chains.',
				results: analysisResults.map(
					(suggestion): CommandResult => ({
						kind: 'analysis',
						suggestion
					})
				)
			};

			const presetLane: Omit<QueryLane, 'startIndex'> = {
				key: 'presets',
				title: 'Template chains',
				description: 'Multi-stage recipes tuned to this schema.',
				results: filteredPresetSuggestions.map(
					(suggestion): CommandResult => ({
						kind: 'preset',
						suggestion
					})
				)
			};

			const hasExplicitStageIntent = !!explicitStageIntent;
			const nonFunctionResultCount = [stageLane, semanticLane, analysisLane, presetLane].reduce(
				(count, lane) => count + lane.results.length,
				0
			);
			const functionLane: Omit<QueryLane, 'startIndex'> = {
				key: 'functions',
				title: 'Function results',
				description: 'Derived functions that match your query.',
				results:
					hasExplicitStageIntent && nonFunctionResultCount > 0
						? []
						: functionResults.map(
								(suggestion): CommandResult => ({
									kind: 'function',
									suggestion
								})
							)
			};

			const lanes: Array<Omit<QueryLane, 'startIndex'>> = hasExplicitStageIntent
				? [stageLane, semanticLane, analysisLane, presetLane, functionLane]
				: queryLooksAnalytical
					? [analysisLane, semanticLane, presetLane, stageLane, functionLane]
					: [functionLane, stageLane, semanticLane, analysisLane, presetLane];

			let startIndex = 0;
			return lanes
				.filter((lane) => lane.results.length > 0)
				.map((lane) => {
					const nextLane = {
						...lane,
						startIndex
					};
					startIndex += lane.results.length;
					return nextLane;
				});
		})()
	);

	const commandResults = $derived(queryLanes.flatMap((lane) => lane.results));

	function onQueryInput() {
		promptPlan = null;
		promptPlanMessage = null;
	}

	function closeAfterApply() {
		query = '';
		promptPlan = null;
		promptPlanMessage = null;
		open = false;
	}

	function normalizeStageSequence(stagesToAdd: Exclude<GUIPipelineStage, { type: 'raw' }>[]) {
		return stagesToAdd.map((stage) => {
			if (stage.type !== 'group') return stage;
			return {
				...stage,
				aggregations: stage.aggregations.map((aggregation) => ({
					...aggregation,
					func: aggregation.func === 'avg' ? 'average' : aggregation.func
				}))
			};
		});
	}

	function applyStageSequence(stagesToAdd: Exclude<GUIPipelineStage, { type: 'raw' }>[]) {
		if (stagesToAdd.length === 0) return;
		const normalized = normalizeStageSequence(stagesToAdd);
		// Skip reconciliation when availableColumns is empty — no reference to validate against,
		// so reconcile would silently drop every stage.
		const normalizedStages =
			availableColumns.length > 0
				? reconcileStageSequenceToAvailableColumns(normalized, availableColumns)
				: normalized;
		if (onAddPreset) {
			onAddPreset(normalizedStages);
			return;
		}

		for (const stage of normalizedStages) {
			onAdd(stage);
		}
	}

	async function runPromptGeneration(mode: PromptGenerationMode = 'fast', forceApply = false) {
		if (normalizedQuery.length === 0) {
			promptPlan = null;
			promptPlanMessage = null;
			llmFullQuery = null;
			return;
		}

		// ── LLM full-query path ───────────────────────────────────────────────────
		if (mode === 'llm') {
			// Fast-path pre-check: skip LLM for very high-confidence rule-based matches
			const FAST_PATH_LLM_BYPASS_THRESHOLD = 0.96;
			const fastPrecheck = generatePromptStagePlan({
				query,
				availableColumns,
				autoApplyThreshold: FAST_PATH_LLM_BYPASS_THRESHOLD,
				validateCompile: false
			});
			if (
				fastPrecheck &&
				fastPrecheck.validation.isValid &&
				fastPrecheck.confidence >= FAST_PATH_LLM_BYPASS_THRESHOLD
			) {
				promptPlan = fastPrecheck;
				promptPlanSource = 'fast';
				promptPlanMessage = `Fast match (${Math.round(fastPrecheck.confidence * 100)}% confidence) — no LLM needed.`;
				if (forceApply) {
					applyStageSequence(fastPrecheck.stages);
					closeAfterApply();
				}
				return;
			}

			cancelActiveGenerate();
			llmGenerating = true;
			llmFullQuery = null;
			promptPlan = null;
			promptPlanMessage = 'AI generating full query (window functions, joins, complex analytics)…';
			try {
				// For external connections with no profiles yet, proactively fetch a sample
				// Fire-and-forget — won't block this call but enriches the next one
				if (connectionId !== BUILTIN_DUCKDB_CONNECTION_ID) {
					const fromSt = stages.find((s) => s.type === 'from') as
						| { type: 'from'; table: string }
						| undefined;
					const extTable = fromSt?.table;
					if (extTable) {
						const extConn = getConnections().find((c) => c.id === connectionId);
						if (extConn) {
							void fetchAndProfileExternalTable({
								connectionId,
								sourceTable: extTable,
								connection: extConn as unknown as Record<string, unknown> & {
									id: string;
									type: string;
								}
							}).catch(() => {});
						}
					}
				}

				const llmContext = await getLLMPlanningContext({
					connectionId,
					stages,
					availableColumns,
					maxColumns: 20,
					maxSamplesPerColumn: 4
				});

				// Determine source table from the first from-stage
				const fromStage = stages.find((s) => s.type === 'from') as
					| { type: 'from'; table: string }
					| undefined;
				const sourceTable = llmContext.sourceTable ?? fromStage?.table ?? '';

				// Include other loaded tables for join suggestions + SQL type lookup
				const loadedTables = getTables();
				const sourceTableMeta = loadedTables.find((t) => t.name === sourceTable);
				const sqlTypeByColumn = new Map(
					(sourceTableMeta?.columns ?? []).map(
						(col, i) => [col, sourceTableMeta?.columnTypes[i]] as const
					)
				);

				// Build typed column list from llmContext — include all rich fields for ranking + context
				const columns = llmContext.columns.map((col) => ({
					name: col.name,
					dataKind: col.dataKind as 'numeric' | 'date' | 'boolean' | 'text',
					semanticType: col.semanticType,
					sqlType: sqlTypeByColumn.get(col.name),
					sampleValues: col.sampleValues?.slice(0, 5) ?? [],
					nullRatio: col.nullRatio,
					distinctCount: col.distinctCount,
					minVal: col.minVal,
					maxVal: col.maxVal,
					p50Val: col.p50Val,
					dateGranularity: col.dateGranularity,
					topValues: col.topValues
				}));

				const otherTables = loadedTables
					.filter((t) => t.name !== sourceTable)
					.slice(0, 6)
					.map((t) => ({ name: t.name, columns: t.columns, columnTypes: t.columnTypes }));

				const result = await generateFullPRQLWithLLM(
					{
						query,
						sourceTable,
						columns,
						otherTables: otherTables.length > 0 ? otherTables : undefined,
						llmConfig,
						timeoutMs: 150_000
					},
					(msg) => {
						promptPlanMessage = msg;
					}
				);

				if (result && result.prql.trim()) {
					llmFullQuery = result;
					promptPlanMessage = result.reasoning
						? `AI: ${result.reasoning}`
						: 'AI query ready — review the PRQL below and apply.';
					if (forceApply) {
						applyLLMFullQuery();
						closeAfterApply();
					}
				} else {
					promptPlanMessage = 'AI returned no query. Check your LLM configuration.';
				}
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					// Cancelled by a newer request — silently clear
					promptPlanMessage = null;
				} else {
					const message = err instanceof Error ? err.message : 'AI inference failed.';
					promptPlanMessage = `AI error: ${message}`;
				}
			}
			llmGenerating = false;
			return;
		}

		// ── Fast / local planner path ─────────────────────────────────────────────
		let plan: PromptStageGenerationPlan | null = null;

		plan = generatePromptStagePlan({
			query,
			availableColumns,
			autoApplyThreshold: PROMPT_AUTO_APPLY_THRESHOLD,
			validateCompile: false
		});

		if (!plan) {
			promptPlan = null;
			promptPlanMessage = 'No prompt plan could be generated from the current schema.';
			return;
		}

		promptPlan = plan;
		promptPlanSource = 'fast';
		const confidencePercent = Math.round(plan.confidence * 100);

		if ((plan.autoApply || forceApply) && plan.validation.isValid) {
			applyStageSequence(plan.stages);
			closeAfterApply();
			return;
		}

		if (!plan.validation.isValid) {
			const reason =
				plan.validation.compileIssues[0] ??
				plan.validation.issues[0] ??
				(plan.validation.unknownColumns.length > 0
					? `unresolved columns: ${plan.validation.unknownColumns.join(', ')}`
					: 'validation failed');
			promptPlanMessage = `Generated draft needs edits before apply (${reason}).`;
			return;
		}

		promptPlanMessage = `Fast draft generated at ${confidencePercent}% confidence. Review and apply.`;
	}

	function applyLLMFullQuery() {
		if (!llmFullQuery?.prql) return;

		// Try to reconstruct proper GUI stages from the generated PRQL continuation.
		// prqlToGuiStages needs a full query starting with `from`, so we prepend the
		// source table, parse, then drop the from-stage (already in the pipeline).
		const fromStage = stages.find((s) => s.type === 'from') as
			| { type: 'from'; table: string }
			| undefined;
		if (fromStage?.table) {
			const fullPreql = `from ${fromStage.table}\n${llmFullQuery.prql}`;
			const parsed = prqlToGuiStages(fullPreql);
			const continuation = parsed?.filter((s) => s.type !== 'from') ?? null;
			if (continuation && continuation.length > 0 && !continuation.some((s) => s.type === 'raw')) {
				// Skip reconciliation: AI output is a coherent complete pipeline.
				// Reconciliation silently drops columns it can't verify, mangling group/select stages.
				const normalized = normalizeStageSequence(
					continuation as Exclude<GUIPipelineStage, { type: 'raw' }>[]
				);
				if (onAddPreset) {
					onAddPreset(normalized);
				} else {
					for (const stage of normalized) {
						onAdd(stage);
					}
				}
				closeAfterApply();
				return;
			}
		}

		// Fallback: add as a single raw stage when parsing is incomplete.
		onAdd({ type: 'raw', prql: llmFullQuery.prql });
		closeAfterApply();
	}

	function applyPromptPlan() {
		if (!promptPlan) return;
		if (!promptPlan.validation.isValid) {
			promptPlanMessage =
				'Prompt plan is not valid yet. Refine the query or pick a suggestion manually.';
			return;
		}
		applyStageSequence(promptPlan.stages);
		closeAfterApply();
	}

	function choose(type: StageType) {
		onAdd(makeDefaultStage(type));
		closeAfterApply();
	}

	function choosePreset(stagesToAdd: Exclude<GUIPipelineStage, { type: 'raw' }>[]) {
		if (stagesToAdd.length === 0) return;
		applyStageSequence(stagesToAdd);
		closeAfterApply();
	}

	function chooseQuickChip(index: number) {
		const chip = quickChips[index];
		if (!chip) return;
		onAdd(chip.stage);
		closeAfterApply();
	}

	function chooseCommand(result: CommandResult | undefined) {
		if (!result) return;
		if (result.kind === 'stage') {
			choose(result.type);
			return;
		}
		if (result.kind === 'function') {
			onAdd(result.suggestion.stage);
			closeAfterApply();
			return;
		}
		if (result.kind === 'semantic') {
			onAdd(result.suggestion.stage);
			closeAfterApply();
			return;
		}
		if (result.kind === 'analysis') {
			if (result.suggestion.stages.length === 0) return;
			applyStageSequence(result.suggestion.stages);
			closeAfterApply();
			return;
		}
		choosePreset(result.suggestion.stages);
	}

	function chooseByIndex(index: number) {
		if (normalizedQuery.length > 0) {
			chooseCommand(commandResults[index]);
			return;
		}
		if (quickChips[index]) {
			chooseQuickChip(index);
			return;
		}
		const stage = stageResults[index];
		if (stage) choose(stage.type);
	}

	let menuScopeEl: HTMLElement | undefined = $state();

	$effect(() => {
		if (!menuScopeEl) return;
		return registerStageMenu(menuScopeEl, {
			isOpen: () => open,
			openMenu: () => {
				query = '';
				open = true;
			},
			closeMenu: () => {
				open = false;
			},
			chooseByIndex,
			handleEnter: ({ shiftKey, fromTyping }) => {
				if (fromTyping && normalizedQuery.length > 0) {
					void runPromptGeneration('llm', shiftKey);
					return;
				}
				if (!fromTyping) {
					if (normalizedQuery.length > 0) {
						void runPromptGeneration('llm', shiftKey);
						return;
					}
					if (quickChips.length > 0) {
						chooseQuickChip(0);
						return;
					}
					const firstStage = stageResults[0];
					if (firstStage) choose(firstStage.type);
				}
			},
			runCmdEnter: () => void runPromptGeneration('llm', true)
		});
	});
</script>

<div bind:this={menuScopeEl} class="mt-1 border-t pt-2" data-keyboard-scope="stage-menu">
	<div class="flex items-center justify-between gap-2">
		<div
			class="add-stage-title flex items-center gap-1.5 font-mono text-2xs text-muted-foreground/60 lowercase"
		>
			<Sparkles class="h-3 w-3" />
			<span>add stage</span>
		</div>

		<Dialog.Root bind:open>
			<Dialog.Trigger>
				<span class="add-stage-trigger">
					<Button
						variant="outline"
						size="icon-xs"
						class="font-mono"
						aria-label="Open stage picker"
						title="Keyboard: A to open, 1-8 to pick"
					>
						<Plus class="h-3.5 w-3.5" />
					</Button>
				</span>
			</Dialog.Trigger>

			<Dialog.Content
				class="max-w-180 overflow-hidden border-border/70 bg-background/98 p-0 shadow-2xl"
				data-keyboard-scope="stage-menu"
			>
				<div
					class="sticky top-0 z-10 border-b border-border/60 bg-background/96 px-3 pt-2.5 pb-2 backdrop-blur-sm"
				>
					<div class="flex items-center gap-2">
						<div class="relative flex-1">
							<Search
								class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
							/>
							<Input
								bind:ref={searchRef}
								bind:value={query}
								autofocus
								placeholder="Prompt or search stages, templates, and columns..."
								class="h-8 border-border/60 bg-muted/15 pl-8 text-xs placeholder:text-muted-foreground/50"
								oninput={onQueryInput}
							/>
						</div>
						{#if llmGenerating}
							<Button
								variant="outline"
								size="sm"
								class="h-8 shrink-0 px-3 text-xs"
								onclick={() => {
									cancelActiveGenerate();
									llmGenerating = false;
									promptPlanMessage = null;
								}}
							>
								<Sparkles class="mr-1 h-3 w-3 animate-spin" />
								Cancel
							</Button>
						{:else}
							<Button
								variant="secondary"
								size="sm"
								class="h-8 shrink-0 px-3 text-xs"
								onclick={() => void runPromptGeneration('llm', false)}
								disabled={normalizedQuery.length === 0}
							>
								<Sparkles class="mr-1.5 h-3 w-3" />
								Generate
							</Button>
						{/if}
					</div>
					<!-- Compact keyboard hint row -->
					<div class="flex items-center gap-2 pt-1.5 pb-0.5">
						<span class="mr-0.5 text-[9px] tracking-[0.18em] text-muted-foreground/50 uppercase"
							>Stage palette</span
						>
						{#each [['/', 'open'], ['1–9', 'pick'], ['↵', 'AI generate'], ['⌘↵', 'AI + apply']] as [key, hint]}
							<span class="inline-flex items-center gap-1 text-[9px] text-muted-foreground/50">
								<kbd
									class="rounded border border-border/50 bg-muted/40 px-1 py-0.5 font-mono text-[8px] leading-none"
									>{key}</kbd
								>
								{hint}
							</span>
						{/each}
					</div>
				</div>

				<div class="max-h-[70vh] overflow-auto px-3 pt-2 pb-3">
					{#if normalizedQuery.length > 0}
						{#if llmFullQuery}
							<div class="mb-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<p class="flex items-center gap-1.5 text-[11px] font-medium text-primary">
										<Sparkles class="h-3 w-3" />
										AI full query — window / join / analytics
									</p>
									<div class="flex items-center gap-2">
										<span class="add-stage-badge border-primary/30 bg-primary/15 text-primary"
											>AI</span
										>
										<Button
											variant="outline"
											size="sm"
											class="h-7 border-primary/30 px-2 text-[10px] hover:bg-primary/10"
											onclick={applyLLMFullQuery}
										>
											Apply
										</Button>
									</div>
								</div>
								<pre
									class="mt-2 max-h-40 overflow-x-auto rounded bg-muted/20 p-2 font-mono text-[10px] leading-relaxed whitespace-pre text-muted-foreground">{llmFullQuery.prql}</pre>
							</div>
						{/if}

						{#if promptPlan}
							<div class="mb-2 rounded-lg border border-primary/30 bg-primary/[0.07] px-2.5 py-2">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<p class="text-[11px] text-primary/95">
										Generated block: {promptPlan.suggestion.label}
									</p>
									<div class="flex items-center gap-2">
										<span class="add-stage-badge">Fast</span>
										<span class="add-stage-badge"
											>{Math.round(promptPlan.confidence * 100)}% confidence</span
										>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-[10px] text-muted-foreground"
											onclick={() => void runPromptGeneration('llm', false)}
											disabled={llmGenerating}
										>
											<Sparkles class="mr-1 h-3 w-3" />
											Use AI
										</Button>
										<Button
											variant="outline"
											size="sm"
											class="h-7 px-2 text-[10px]"
											onclick={applyPromptPlan}
											disabled={!promptPlan.validation.isValid}
										>
											Apply block
										</Button>
									</div>
								</div>
								<p class="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
									{promptPlan.suggestion.prompt}
								</p>
							</div>
						{/if}

						{#if promptPlanMessage}
							<p
								class="mb-2 rounded-md border border-border/65 bg-muted/15 px-2.5 py-1.5 text-[10px] text-muted-foreground"
							>
								{promptPlanMessage}
							</p>
						{/if}

						{#if matchedColumn}
							<div
								class="mb-2 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.07] px-2.5 py-1.5"
							>
								<p class="text-[11px] text-primary/95">Semantic column match detected</p>
								<span class="add-stage-badge">Adapted for {matchedColumn}</span>
							</div>
						{/if}

						{#if commandResults.length === 0}
							<p class="px-2 py-5 text-center text-xs text-muted-foreground">
								No matching stage, function, semantic combination, analysis prompt, or preset
							</p>
						{:else}
							<div class="space-y-3">
								{#each queryLanes as lane (lane.key)}
									<section class="space-y-0.5">
										<div class="flex items-center gap-2 px-0.5 pb-0.5">
											<p class="chip-lane-heading">{lane.title}</p>
											<span class="text-[9px] text-muted-foreground/50">{lane.description}</span>
										</div>
										{#each lane.results as result, idx (`${lane.key}-${idx}`)}
											<button
												class="w-full rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-[background-color,border-color] duration-120 hover:border-border/70 hover:bg-accent"
												onclick={() => chooseCommand(result)}
											>
												<div class="flex items-center gap-2">
													<span
														class="w-3.5 shrink-0 font-mono text-[10px] text-muted-foreground/60 tabular-nums"
														>{lane.startIndex + idx + 1}</span
													>
													{#if result.kind === 'stage'}
														{@const ItemIcon = ICONS[result.type]}
														<ItemIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
													{:else if result.kind === 'function'}
														<Calculator class="h-3.5 w-3.5 shrink-0 text-primary/70" />
													{:else}
														<WandSparkles class="h-3.5 w-3.5 shrink-0 text-primary/70" />
													{/if}
													<div class="flex min-w-0 items-baseline gap-1.5">
														<p class="shrink-0 text-xs font-medium text-foreground">
															{#if result.kind === 'stage'}{result.label}
															{:else if result.kind === 'preset'}{result.suggestion.preset.label}
															{:else if result.kind === 'function'}{result.suggestion.label}
															{:else if result.kind === 'analysis'}{result.suggestion.label}
															{:else}{result.suggestion.label}{/if}
														</p>
														<span
															class="add-stage-kind shrink-0"
															class:add-stage-kind--preset={result.kind === 'preset'}
														>
															{#if result.kind === 'stage'}Stage
															{:else if result.kind === 'preset'}Template
															{:else if result.kind === 'function'}Function
															{:else if result.kind === 'analysis'}Query
															{:else}Semantic{/if}
														</span>
														<p class="truncate text-[10px] text-muted-foreground/65">
															{#if result.kind === 'stage'}{result.description}
															{:else if result.kind === 'preset'}{result.suggestion.reasons[0] ??
																	result.suggestion.preset.description}
															{:else if result.kind === 'function'}{result.suggestion.description}
															{:else if result.kind === 'analysis'}{result.suggestion.prompt}
															{:else}{result.suggestion.description}{/if}
														</p>
													</div>
												</div>
											</button>
										{/each}
									</section>
								{/each}
							</div>
						{/if}
					{:else}
						<div class="space-y-4 py-0.5">
							{#if quickChips.length > 0}
								<section class="space-y-1">
									<p class="chip-lane-heading px-0.5">Suggested for this pipeline</p>
									<div class="space-y-0.5">
										{#each quickChips as chip, idx (chip.id)}
											{@const ItemIcon = ICONS[chip.icon]}
											<button
												class="w-full rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-[background-color,border-color] duration-120 hover:border-border/80 hover:bg-accent"
												onclick={() => chooseQuickChip(idx)}
												title={chip.label}
											>
												<div class="flex items-center gap-2">
													<span
														class="w-3.5 font-mono text-[10px] text-muted-foreground/60 tabular-nums"
														>{idx + 1}</span
													>
													<ItemIcon
														class="h-3.5 w-3.5 shrink-0 {chip.tone === 'primary'
															? 'text-primary'
															: 'text-muted-foreground/70'}"
													/>
													<p class="min-w-0 truncate text-xs font-medium text-foreground">
														{chip.label}
													</p>
												</div>
											</button>
										{/each}
									</div>
								</section>
							{/if}

							<section class="space-y-1.5">
								<div class="flex items-center gap-2 px-0.5">
									<p class="chip-lane-heading">Stage primitives</p>
									<span class="text-[9px] text-muted-foreground/50">press number to add</span>
								</div>
								<div class="grid grid-cols-2 gap-1">
									{#each stageResults as item, idx (item.type)}
										{@const ItemIcon = ICONS[item.type]}
										<button
											class="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/8 px-2.5 py-2 text-left transition-[background-color,border-color] duration-120 ease-(--motion-ease-out) hover:border-border/80 hover:bg-accent"
											onclick={() => choose(item.type)}
											title={item.description}
										>
											<span
												class="w-3.5 shrink-0 font-mono text-[10px] text-muted-foreground/60 tabular-nums"
												>{idx + 1}</span
											>
											<ItemIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
											<div class="min-w-0">
												<p class="text-xs leading-tight font-medium text-foreground">
													{item.label}
												</p>
												<p class="truncate text-[10px] text-muted-foreground/70">
													{item.description}
												</p>
											</div>
										</button>
									{/each}
								</div>
							</section>

							<!-- Templates + analysis collapsed behind toggle -->
							<button
								class="flex w-full items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
								onclick={() => (showMoreStageOptions = !showMoreStageOptions)}
							>
								<span class="text-[9px]">{showMoreStageOptions ? '▾' : '▸'}</span>
								Templates &amp; analysis prompts
								{#if filteredPresetSuggestions.length + analysisResults.length > 0}
									<span class="text-[9px] opacity-60"
										>({filteredPresetSuggestions.length + analysisResults.length})</span
									>
								{/if}
							</button>

							{#if showMoreStageOptions}
								<section class="space-y-1">
									<div class="flex items-center gap-2 px-0.5">
										<p class="chip-lane-heading">Templates</p>
										{#if matchedColumn}<span class="add-stage-badge">{matchedColumn}</span>{/if}
									</div>
									<div class="space-y-0.5">
										{#each filteredPresetSuggestions as suggestion, idx (suggestion.preset.id)}
											{@const referencesMatchedColumn = presetMentionsColumn(
												suggestion,
												matchedColumn
											)}
											<button
												class="w-full rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-[background-color,border-color,opacity] duration-120 hover:border-border/80 hover:bg-accent {matchedColumn &&
												!referencesMatchedColumn
													? 'opacity-55'
													: ''}"
												onclick={() => choosePreset(suggestion.stages)}
												title={suggestion.preset.description}
											>
												<div class="flex items-center gap-2">
													<span
														class="w-3.5 shrink-0 font-mono text-[10px] text-muted-foreground/60 tabular-nums"
														>{idx + 1}</span
													>
													<WandSparkles class="h-3 w-3 shrink-0 text-primary/70" />
													<div class="min-w-0">
														<p class="truncate text-xs font-medium text-foreground">
															{suggestion.preset.label}
														</p>
														<p class="truncate text-[10px] text-muted-foreground/70">
															{suggestion.reasons[0] ?? suggestion.preset.description}
														</p>
													</div>
												</div>
											</button>
										{/each}
									</div>
								</section>

								{#if analysisResults.length > 0}
									<section class="space-y-1">
										<p class="chip-lane-heading px-0.5">Analysis prompts</p>
										<div class="space-y-0.5">
											{#each analysisResults as suggestion, idx (suggestion.id)}
												<button
													class="w-full rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-[background-color,border-color] duration-120 hover:border-border/80 hover:bg-accent"
													onclick={() => chooseCommand({ kind: 'analysis', suggestion })}
													title={suggestion.prompt}
												>
													<div class="flex items-center gap-2">
														<span
															class="w-3.5 shrink-0 font-mono text-[10px] text-muted-foreground/60 tabular-nums"
															>{idx + 1}</span
														>
														<Sparkles class="h-3 w-3 shrink-0 text-primary/70" />
														<div class="min-w-0">
															<p class="truncate text-xs font-medium text-foreground">
																{suggestion.label}
															</p>
															<p class="truncate text-[10px] text-muted-foreground/70">
																{suggestion.prompt}
															</p>
														</div>
													</div>
												</button>
											{/each}
										</div>
									</section>
								{/if}
							{/if}
						</div>
					{/if}
				</div>
			</Dialog.Content>
		</Dialog.Root>
	</div>
</div>

<style>
	.add-stage-trigger {
		position: relative;
		display: inline-flex;
		border-radius: 0.375rem;
	}

	.add-stage-trigger:hover :global(button) {
		border-color: hsl(var(--muted-foreground) / 0.45);
	}

	.add-stage-badge {
		font-size: var(--text-2xs, 0.6875rem);
		line-height: 1.1;
		padding: 0.2rem 0.5rem;
		border-radius: calc(var(--radius) - 2px);
		border: 1px solid hsl(var(--border));
		background: hsl(var(--muted) / 0.5);
		color: hsl(var(--muted-foreground));
		text-transform: none;
	}

	.add-stage-kind {
		font-size: 9px;
		line-height: 1;
		padding: 0.18rem 0.35rem;
		border-radius: 999px;
		border: 1px solid hsl(var(--border));
		color: hsl(var(--muted-foreground));
		background: hsl(var(--background));
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.add-stage-kind--preset {
		border-color: hsl(var(--primary) / 0.35);
		color: hsl(var(--primary));
		background: hsl(var(--primary) / 0.08);
	}
</style>
