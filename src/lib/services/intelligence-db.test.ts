import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeSQLMock, initDBMock } = vi.hoisted(() => ({
	executeSQLMock: vi.fn(),
	initDBMock: vi.fn()
}));

vi.mock('$lib/services/duckdb', () => ({
	executeSQL: executeSQLMock,
	initDB: initDBMock,
	dropProfileTable: vi.fn().mockResolvedValue(undefined)
}));

import {
	getLLMPlanningContext,
	getIntelligentQuickChips,
	getIntelligentPresetSuggestions,
	recommendIntelligentChartTypes,
	refreshSemanticMetadataBackfill,
	recordCellExecutionMetadata,
	recordUploadedTableMetadata,
	registerSemanticSynonyms
} from '$lib/services/intelligence-db';
import { guiToPreql } from '$lib/services/gui-prql';
import {
	compile as compileNodePrql,
	CompileOptions as NodeCompileOptions
} from 'prqlc/dist/node/prqlc_js';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';

describe('intelligence-db', () => {
	beforeEach(() => {
		executeSQLMock.mockReset();
		initDBMock.mockReset();
		initDBMock.mockResolvedValue(undefined);
		executeSQLMock.mockResolvedValue({ rows: [], columns: [] });
	});

	it('records uploaded table schema metadata', async () => {
		await recordUploadedTableMetadata({
			connectionId: 'builtin.duckdb',
			table: {
				name: 'orders',
				fileName: 'orders.csv',
				rowCount: 120,
				columns: ['id', 'created_at', 'amount'],
				columnTypes: ['BIGINT', 'TIMESTAMP', 'DOUBLE']
			}
		});

		expect(initDBMock).toHaveBeenCalled();
		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('CREATE TABLE IF NOT EXISTS _lunapad_metadata.table_profiles')
		);
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining("'uploaded'"));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('column_profiles'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic_type'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic_signature'));
	});

	it('records cell runs and stage usage metadata', async () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'orders' },
			{ type: 'filter', conditions: [{ column: 'status', op: '==', value: 'open' }], logic: 'and' },
			{ type: 'sort', keys: [{ column: 'created_at', dir: 'desc' }] }
		];

		await recordCellExecutionMetadata({
			runId: 'run-1',
			notebookId: 'nb-1',
			cellId: 'cell-1',
			connectionId: 'builtin.duckdb',
			status: 'success',
			runtimeMs: 42,
			rowCount: 2,
			columnCount: 3,
			tablesTouched: ['orders'],
			resultColumns: ['id', 'status', 'created_at'],
			resultRows: [
				{ id: 1, status: 'open', created_at: '2026-05-01' },
				{ id: 2, status: 'closed', created_at: '2026-05-02' }
			],
			outputName: 'result1',
			stages
		});

		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO _lunapad_metadata.cell_runs')
		);
		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO _lunapad_metadata.stage_usage')
		);
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('stage_sequence_usage'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic_confidence'));
		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO _lunapad_metadata.signature_usage')
		);
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('result1'));
	});

	it('builds llm planning context from semantic metadata and samples', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Completion Time',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at|shape=iso-date|confidence=high',
							semantic_confidence: 0.93,
							null_ratio: 0,
							distinct_count: 400,
							sample_values_json: '["2026-01-03","2026-01-04"]'
						},
						{
							column_name: 'Payee',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name|shape=mixed|confidence=high',
							semantic_confidence: 0.86,
							null_ratio: 0.05,
							distinct_count: 900,
							sample_values_json: '["MAMA KIM","UBER B.V"]'
						},
						{
							column_name: 'Withdrawn',
							data_kind: 'numeric',
							semantic_type: 'outflow',
							semantic_signature: 'kind=numeric|semantic=outflow|shape=float|confidence=high',
							semantic_confidence: 0.9,
							null_ratio: 0.1,
							distinct_count: 650,
							sample_values_json: '["-20.0","-230.0"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const context = await getLLMPlanningContext({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'since23' }],
			availableColumns: ['Completion Time', 'Payee', 'Withdrawn']
		});

		expect(context.sourceTable).toBe('since23');
		expect(context.pipelineStageTypes).toEqual(['from']);
		expect(context.columns).toHaveLength(3);
		expect(context.columns[0]?.name).toBe('Completion Time');
		expect(context.columns[0]?.sampleValues).toEqual(['2026-01-03', '2026-01-04']);
		expect(context.columns[1]?.semanticType).toBe('entity_name');
		expect(context.columns[2]?.semanticType).toBe('outflow');
	});

	it('falls back to inferred context when metadata lookup fails', async () => {
		executeSQLMock.mockRejectedValueOnce(new Error('db unavailable'));

		const context = await getLLMPlanningContext({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'since23' }],
			availableColumns: ['Completion Time', 'Payee', 'Withdrawn']
		});

		expect(context.columns).toHaveLength(3);
		expect(context.columns.some((column) => column.semanticType === 'entity_name')).toBe(true);
		expect(
			context.columns.some(
				(column) =>
					column.semanticType === 'date' ||
					column.semanticType === 'updated_at' ||
					column.semanticType === 'event_time'
			)
		).toBe(true);
	});

	it('uses metadata tables to prioritize intelligent chips', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return {
					rows: [
						{ stage_type: 'group', column_name: 'region', usage_count: 12 },
						{ stage_type: 'sort', column_name: 'created_at', usage_count: 8 }
					],
					columns: ['stage_type', 'column_name', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'created_at',
							data_kind: 'date',
							null_ratio: 0.01,
							distinct_count: 300,
							sample_values_json: '["2026-05-01","2026-05-30"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							null_ratio: 0.02,
							distinct_count: 250,
							sample_values_json: '["120.5"]'
						},
						{
							column_name: 'is_active',
							data_kind: 'boolean',
							null_ratio: 0.0,
							distinct_count: 2,
							sample_values_json: '["true","false"]'
						},
						{
							column_name: 'region',
							data_kind: 'text',
							null_ratio: 0.0,
							distinct_count: 12,
							sample_values_json: '["EMEA","NA"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['region', 'amount', 'created_at', 'status']
		});

		expect(chips.length).toBeGreaterThan(0);
		expect(chips[0]?.label).toContain('Created At');
		expect(chips[0]?.hydration.semanticCategory).toBeDefined();
		expect(chips[0]?.hydration.analysisPattern.length).toBeGreaterThan(0);
		expect(chips.some((chip) => chip.label.includes('Filter Is Active'))).toBe(false);
		expect(chips.some((chip) => chip.icon === 'group')).toBe(true);
		expect(chips.some((chip) => chip.icon === 'derive')).toBe(true);
	});

	it('generates at least five rich chips from result evidence across stages', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes("tp.source_kind = 'cell-result'")) {
				return {
					rows: [
						{
							relation_name: 'result1',
							last_seen_ms: 1900000000000,
							column_name: 'updatedAt',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at|shape=iso-date',
							semantic_confidence: 0.95,
							null_ratio: 0.01,
							distinct_count: 200,
							sample_values_json: '["2026-05-30 17:00:00","2026-05-29 12:10:00"]'
						},
						{
							relation_name: 'result1',
							last_seen_ms: 1900000000000,
							column_name: 'type',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category|shape=mixed',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 4,
							sample_values_json: '["url","html","pdf"]'
						},
						{
							relation_name: 'result1',
							last_seen_ms: 1900000000000,
							column_name: 'image',
							data_kind: 'text',
							semantic_type: 'url',
							semantic_signature: 'kind=text|semantic=url|shape=mixed',
							semantic_confidence: 0.8,
							null_ratio: 0.05,
							distinct_count: 150,
							sample_values_json: '["unavailable","archives/1/60452.jpeg"]'
						},
						{
							relation_name: 'result1',
							last_seen_ms: 1900000000000,
							column_name: 'collectionId',
							data_kind: 'numeric',
							semantic_type: 'foreign_key',
							semantic_signature: 'kind=numeric|semantic=foreign_key|shape=int',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 8,
							sample_values_json: '["1","3","6"]'
						},
						{
							relation_name: 'result1',
							last_seen_ms: 1900000000000,
							column_name: 'textContent',
							data_kind: 'text',
							semantic_type: 'description',
							semantic_signature: 'kind=text|semantic=description|shape=long',
							semantic_confidence: 0.92,
							null_ratio: 0.1,
							distinct_count: 190,
							sample_values_json:
								'["This is a long body of content with enough words to clearly exceed fifty characters for deriving lengths."]'
						}
					],
					columns: [
						'relation_name',
						'last_seen_ms',
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return { rows: [], columns: [] };
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'result1' }],
			availableColumns: ['id', 'type', 'image', 'collectionId', 'updatedAt', 'textContent']
		});

		expect(chips.length).toBeGreaterThanOrEqual(5);
		expect(
			chips.some((chip) => chip.stage.type === 'sort' && chip.label.includes('Updated At'))
		).toBe(true);
		expect(chips.some((chip) => chip.stage.type === 'filter' && chip.label.includes('Type'))).toBe(
			true
		);
		expect(
			chips.some(
				(chip) =>
					chip.stage.type === 'filter' &&
					chip.label.includes('Image') &&
					chip.label.includes('available')
			)
		).toBe(true);
		expect(
			chips.some(
				(chip) =>
					chip.stage.type === 'group' &&
					chip.label.toLowerCase().includes('count rows') &&
					(chip.label.includes('Type') || chip.label.includes('Collection Id'))
			)
		).toBe(true);
		expect(
			chips.some(
				(chip) =>
					chip.stage.type === 'derive' &&
					chip.label.includes('Text Content') &&
					chip.label.includes('length')
			)
		).toBe(true);
		expect(chips.some((chip) => chip.label.toLowerCase().includes('round clientside'))).toBe(false);
	});

	it('builds intelligent chips from metadata when availableColumns is empty', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'status',
							data_kind: 'text',
							null_ratio: 0,
							distinct_count: 6,
							sample_values_json: '["active","inactive"]'
						},
						{
							column_name: 'created_at',
							data_kind: 'date',
							null_ratio: 0.01,
							distinct_count: 320,
							sample_values_json: '["2026-05-30"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							null_ratio: 0.03,
							distinct_count: 250,
							sample_values_json: '["99.1"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: []
		});

		expect(chips.length).toBeGreaterThan(0);
		expect(chips.some((chip) => chip.label.includes('Created At'))).toBe(true);
		expect(
			chips.some((chip) => chip.label.includes('Created At') && chip.label.includes('2026-05-30'))
		).toBe(true);
		expect(
			chips.some((chip) => chip.icon === 'derive' && chip.label.includes('Round Amount'))
		).toBe(true);
		const filterChip = chips.find(
			(chip) => chip.stage.type === 'filter' && chip.stage.conditions[0]?.column === 'created_at'
		);
		expect(filterChip?.stage.type).toBe('filter');
		if (filterChip?.stage.type === 'filter') {
			expect(filterChip.stage.conditions[0]?.value).toBe('2026-05-30');
			expect(filterChip.stage.conditions[0]?.op).toBe('>=');
		}
	});

	it('uses >= date comparison for date-like filters from metadata samples', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'created_at',
							data_kind: 'date',
							null_ratio: 0.0,
							distinct_count: 300,
							sample_values_json: '["2026-05-01","2026-05-30"]'
						},
						{
							column_name: 'title',
							data_kind: 'text',
							null_ratio: 0.0,
							distinct_count: 300,
							sample_values_json: '["A"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: []
		});

		const filterChip = chips.find(
			(chip) => chip.stage.type === 'filter' && chip.stage.conditions[0]?.column === 'created_at'
		);
		expect(filterChip?.stage.type).toBe('filter');
		if (filterChip?.stage.type === 'filter') {
			expect(filterChip.stage.conditions[0]?.op).toBe('>=');
			expect(filterChip.stage.conditions[0]?.value).toBe('2026-05-30');
		}
	});

	it('does not suggest rounded derive for count-like integer metrics', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'total_jobs',
							data_kind: 'numeric',
							null_ratio: 0,
							distinct_count: 20,
							sample_values_json: '["10","20","30"]'
						},
						{
							column_name: 'created_at',
							data_kind: 'date',
							null_ratio: 0,
							distinct_count: 20,
							sample_values_json: '["2026-05-01","2026-05-30"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'jobs' }],
			availableColumns: []
		});

		expect(chips.some((chip) => chip.icon === 'derive')).toBe(false);
		expect(chips.some((chip) => chip.label.includes('total_jobs_rounded'))).toBe(false);
	});

	it('uses signature backoff, recency decay, and column-aware boosts for ranking', async () => {
		const now = Date.now();
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				if (sql.includes("pipeline_signature = 'from > select'")) {
					return { rows: [], columns: [] };
				}
				if (sql.includes("pipeline_signature <> 'from > select'")) {
					return {
						rows: [
							{
								pipeline_signature: 'from > select > take',
								stage_type: 'filter',
								column_name: 'status',
								usage_count: 6,
								last_used_ms: now - 10 * 60 * 1000
							}
						],
						columns: [
							'pipeline_signature',
							'stage_type',
							'column_name',
							'usage_count',
							'last_used_ms'
						]
					};
				}
				if (sql.includes('ORDER BY last_used_ms DESC')) {
					return {
						rows: [
							{
								pipeline_signature: 'from',
								stage_type: 'sort',
								column_name: 'created_at',
								usage_count: 80,
								last_used_ms: now - 120 * 24 * 60 * 60 * 1000
							}
						],
						columns: [
							'pipeline_signature',
							'stage_type',
							'column_name',
							'usage_count',
							'last_used_ms'
						]
					};
				}
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'status',
							data_kind: 'text',
							null_ratio: 0.01,
							distinct_count: 6,
							sample_values_json: '["active","paused"]'
						},
						{
							column_name: 'created_at',
							data_kind: 'date',
							null_ratio: 0.0,
							distinct_count: 100,
							sample_values_json: '["2026-05-29","2026-05-30"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							null_ratio: 0.02,
							distinct_count: 90,
							sample_values_json: '["120.5"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [
				{ type: 'from', table: 'orders' },
				{ type: 'select', columns: ['status', 'created_at', 'amount'] }
			],
			availableColumns: ['status', 'created_at', 'amount']
		});

		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining("pipeline_signature <> 'from > select'")
		);
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining("LIKE '%select'"));
		expect(
			chips.some((chip) => chip.icon === 'filter' && chip.label.toLowerCase().includes('status'))
		).toBe(true);
	});

	it('keeps distinct same-icon chips when semantics differ', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'is_active',
							data_kind: 'boolean',
							null_ratio: 0.0,
							distinct_count: 2,
							sample_values_json: '["true","false"]'
						},
						{
							column_name: 'created_at',
							data_kind: 'date',
							null_ratio: 0.0,
							distinct_count: 100,
							sample_values_json: '["2026-05-30"]'
						},
						{
							column_name: 'status',
							data_kind: 'text',
							null_ratio: 0.0,
							distinct_count: 8,
							sample_values_json: '["active","inactive"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['status', 'created_at', 'amount']
		});

		const filterLabels = chips.filter((chip) => chip.icon === 'filter').map((chip) => chip.label);
		expect(filterLabels.length).toBeGreaterThanOrEqual(1);
		expect(filterLabels.some((label) => /status/i.test(label))).toBe(true);
		expect(filterLabels.some((label) => /active/i.test(label))).toBe(false);
	});

	it('uses seeded semantic types to shape grouping and filtering chips', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'is_active',
							data_kind: 'boolean',
							semantic_type: 'flag',
							semantic_signature: 'kind=boolean|semantic=flag|shape=mixed',
							null_ratio: 0,
							distinct_count: 2,
							sample_values_json: '["true","false"]'
						},
						{
							column_name: 'region',
							data_kind: 'text',
							semantic_type: 'region',
							semantic_signature: 'kind=text|semantic=region|shape=mixed',
							null_ratio: 0,
							distinct_count: 6,
							sample_values_json: '["EMEA","NA"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float',
							null_ratio: 0,
							distinct_count: 20,
							sample_values_json: '["100.5","45.2"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: []
		});

		expect(
			chips.some(
				(chip) =>
					chip.icon === 'group' && chip.label.includes('Region') && chip.label.includes('Amount')
			)
		).toBe(true);
		expect(chips.some((chip) => chip.icon === 'filter' && chip.label.includes('Is Active'))).toBe(
			true
		);
	});

	it('registers custom semantic synonyms and backfills semantic signatures', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.semantic_synonyms')) {
				return {
					rows: [{ token: 'gmv', canonical: 'revenue', semantic_hint: 'amount', weight: 0.95 }],
					columns: ['token', 'canonical', 'semantic_hint', 'weight']
				};
			}
			if (sql.includes('SELECT relation_name, column_name, data_kind')) {
				return {
					rows: [
						{
							relation_name: 'orders',
							column_name: 'gmv',
							data_kind: 'numeric',
							null_ratio: 0,
							distinct_count: 20,
							sample_values_json: '["100.5","250.25"]'
						},
						{
							relation_name: 'orders',
							column_name: 'region',
							data_kind: 'text',
							null_ratio: 0,
							distinct_count: 5,
							sample_values_json: '["EMEA","NA"]'
						}
					],
					columns: [
						'relation_name',
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		await registerSemanticSynonyms({
			connectionId: 'builtin.duckdb',
			entries: [{ token: 'gmv', canonical: 'revenue', semanticHint: 'amount', weight: 0.95 }]
		});

		await refreshSemanticMetadataBackfill({
			connectionId: 'builtin.duckdb',
			relationName: 'orders'
		});

		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO _lunapad_metadata.semantic_synonyms')
		);
		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('UPDATE _lunapad_metadata.column_profiles')
		);
		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringMatching(/semantic=(amount|unit_price|currency_amount)/)
		);
		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO _lunapad_metadata.signature_usage')
		);
	});

	it('backfills expanded semantic taxonomy for media, ordinal, event, and relational ids', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.semantic_synonyms')) {
				return {
					rows: [],
					columns: ['token', 'canonical', 'semantic_hint', 'weight']
				};
			}
			if (sql.includes('SELECT relation_name, column_name, data_kind')) {
				return {
					rows: [
						{
							relation_name: 'events',
							column_name: 'session_id',
							data_kind: 'text',
							null_ratio: 0,
							distinct_count: 120,
							sample_values_json: '["s1","s2"]'
						},
						{
							relation_name: 'events',
							column_name: 'source_id',
							data_kind: 'text',
							null_ratio: 0,
							distinct_count: 90,
							sample_values_json: '["n1","n2"]'
						},
						{
							relation_name: 'events',
							column_name: 'event_type',
							data_kind: 'text',
							null_ratio: 0,
							distinct_count: 6,
							sample_values_json: '["click","view"]'
						},
						{
							relation_name: 'events',
							column_name: 'image_url',
							data_kind: 'text',
							null_ratio: 0.05,
							distinct_count: 110,
							sample_values_json: '["https://cdn.example.com/a.png"]'
						},
						{
							relation_name: 'events',
							column_name: 'file_path',
							data_kind: 'text',
							null_ratio: 0.02,
							distinct_count: 110,
							sample_values_json: '["/assets/media/sample.mp4"]'
						},
						{
							relation_name: 'events',
							column_name: 'priority_rating',
							data_kind: 'numeric',
							null_ratio: 0,
							distinct_count: 5,
							sample_values_json: '["1","2","3"]'
						}
					],
					columns: [
						'relation_name',
						'column_name',
						'data_kind',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		await refreshSemanticMetadataBackfill({
			connectionId: 'builtin.duckdb',
			relationName: 'events'
		});

		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic=session_id'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic=source_id'));
		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringMatching(/semantic=(event_type|event_time)/)
		);
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic=media_url'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic=media_path'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic=ordinal_rank'));
	});

	it('recommends semantic-aware presets from metadata and sequence usage', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'order_id',
							data_kind: 'text',
							semantic_type: 'id',
							semantic_signature: 'kind=text|semantic=id|shape=mixed|confidence=high',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 200,
							sample_values_json: '["1","2"]'
						},
						{
							column_name: 'updated_at',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at|shape=iso-date|confidence=high',
							semantic_confidence: 0.92,
							null_ratio: 0,
							distinct_count: 200,
							sample_values_json: '["2026-05-01","2026-05-30"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float|confidence=high',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 180,
							sample_values_json: '["100.1","120.4"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'sort', usage_count: 12 },
						{ next_stage: 'group', usage_count: 10 },
						{ next_stage: 'take', usage_count: 8 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['order_id', 'updated_at', 'amount']
		});

		expect(presets.length).toBeGreaterThan(0);
		expect(presets[0]?.hydration.semanticCategory).toBeDefined();
		expect(presets[0]?.hydration.analysisPattern.length).toBeGreaterThan(0);
		expect(presets.some((preset) => preset.preset.id === 'dedup-latest')).toBe(true);
		expect(
			presets.some(
				(preset) =>
					preset.preset.id === 'dedup-latest' &&
					preset.reasons.some((reason) => reason.includes('temporal semantics'))
			)
		).toBe(true);
	});

	it('recommends advanced presets for since23-like semantics', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Completion Time',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at|shape=iso-date|confidence=high',
							semantic_confidence: 0.93,
							null_ratio: 0,
							distinct_count: 400,
							sample_values_json: '["2026-03-18","2026-03-17"]'
						},
						{
							column_name: 'Paid In',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float|confidence=high',
							semantic_confidence: 0.9,
							null_ratio: 0.4,
							distinct_count: 80,
							sample_values_json: '["100.0","0.0"]'
						},
						{
							column_name: 'Withdrawn',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float|confidence=high',
							semantic_confidence: 0.9,
							null_ratio: 0.1,
							distinct_count: 650,
							sample_values_json: '["-20.0","-230.0"]'
						},
						{
							column_name: 'Details',
							data_kind: 'text',
							semantic_type: 'description',
							semantic_signature: 'kind=text|semantic=description|shape=mixed|confidence=high',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 1200,
							sample_values_json: '["Merchant Payment","Customer Transfer"]'
						},
						{
							column_name: 'Payee',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name|shape=mixed|confidence=high',
							semantic_confidence: 0.86,
							null_ratio: 0.05,
							distinct_count: 900,
							sample_values_json: '["MAMA KIM","UBER B.V"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 20 },
						{ next_stage: 'group', usage_count: 18 },
						{ next_stage: 'sort', usage_count: 14 },
						{ next_stage: 'take', usage_count: 9 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'since23' }],
			availableColumns: ['Completion Time', 'Paid In', 'Withdrawn', 'Details', 'Payee', 'Balance']
		});

		expect(presets.map((preset) => preset.preset.id)).toEqual(
			expect.arrayContaining(['cashflow-rollup', 'temporal-trend', 'text-categorize'])
		);

		const cashflow = presets.find((preset) => preset.preset.id === 'cashflow-rollup');
		expect(cashflow?.preset.label).toContain('Paid In');
		expect(cashflow?.preset.label).toContain('Withdrawn');
		expect(cashflow?.reasons[0]).toMatch(/derive inflow\/outflow/i);

		const temporal = presets.find((preset) => preset.preset.id === 'temporal-trend');
		expect(temporal?.preset.label).toContain('Completion Time');
		expect(temporal?.preset.label).toContain('trend');

		const categorize = presets.find((preset) => preset.preset.id === 'text-categorize');
		expect(categorize?.preset.label).toContain('Details');
	});

	it('applies metadata-aware coercion for text metric and temporal columns in intelligent presets', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Completion Time',
							data_kind: 'text',
							semantic_type: 'date',
							semantic_signature: 'kind=text|semantic=date|shape=mixed|confidence=high',
							semantic_confidence: 0.91,
							null_ratio: 0,
							distinct_count: 320,
							sample_values_json: '["2026-03-18 10:00:00","2026-03-17 11:00:00"]'
						},
						{
							column_name: 'Balance',
							data_kind: 'text',
							semantic_type: 'amount',
							semantic_signature: 'kind=text|semantic=amount|shape=mixed|confidence=high',
							semantic_confidence: 0.9,
							null_ratio: 0.05,
							distinct_count: 250,
							sample_values_json: '["120.50","99.10"]'
						},
						{
							column_name: 'Details',
							data_kind: 'text',
							semantic_type: 'description',
							semantic_signature: 'kind=text|semantic=description|shape=mixed|confidence=high',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 900,
							sample_values_json: '["Merchant Payment","Customer Transfer"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: ['context_signature', 'next_stage', 'usage_count'] };
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'since23' }],
			availableColumns: ['Completion Time', 'Balance', 'Details']
		});

		const temporal = presets.find((preset) => preset.preset.id === 'temporal-trend');
		expect(temporal).toBeDefined();
		const temporalDerive = temporal?.stages.find((stage) => stage.type === 'derive');
		expect(temporalDerive?.type).toBe('derive');
		if (temporalDerive?.type === 'derive') {
			expect(
				temporalDerive.columns.some(
					(column) =>
						column.name === 'period_month' &&
						column.expr.mode === 'sstring' &&
						column.expr.template.includes('cast(\\"Completion Time\\" as timestamp)')
				)
			).toBe(true);
		}

		const categorize = presets.find((preset) => preset.preset.id === 'text-categorize');
		expect(categorize).toBeDefined();
		const categorizeDerive = categorize?.stages.find((stage) => stage.type === 'derive');
		expect(categorizeDerive?.type).toBe('derive');
		if (categorizeDerive?.type === 'derive') {
			expect(categorizeDerive.columns.some((column) => column.name === 'Balance_numeric')).toBe(
				true
			);
		}
		const categorizeGroup = categorize?.stages.find((stage) => stage.type === 'group');
		expect(categorizeGroup?.type).toBe('group');
		if (categorizeGroup?.type === 'group') {
			expect(
				categorizeGroup.aggregations.some(
					(aggregation) =>
						aggregation.name === 'total_Balance' && aggregation.column === 'Balance_numeric'
				)
			).toBe(true);
		}
	});

	it('avoids using id-like columns as numeric group metrics', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'name',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name|shape=mixed|confidence=high',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 120,
							sample_values_json: '["Acme","Nova"]'
						},
						{
							column_name: 'id',
							data_kind: 'numeric',
							semantic_type: 'id',
							semantic_signature: 'kind=numeric|semantic=id|shape=int|confidence=high',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 120,
							sample_values_json: '["1","2"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float|confidence=high',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 100,
							sample_values_json: '["10.5","20.2"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: []
		});

		const groupChip = chips.find((chip) => chip.icon === 'group');
		expect(groupChip).toBeDefined();
		expect(groupChip?.label).toContain('Amount');
		expect(groupChip?.label).not.toContain(' id');
		if (groupChip?.stage.type === 'group') {
			expect(groupChip.stage.aggregations[0]?.column).toBe('amount');
		}
	});

	it('uses semantic bootstrap from available columns when metadata rows are missing', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['updatedAt', 'name', 'id']
		});

		expect(chips.some((chip) => chip.icon === 'sort' && chip.label.includes('Updated At'))).toBe(
			true
		);
		expect(chips.some((chip) => chip.icon === 'group' && chip.label.includes('sum id'))).toBe(
			false
		);
		expect(chips.some((chip) => chip.icon === 'derive')).toBe(false);
	});

	it('does not leak unrelated recent-result chips when current available columns are known', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes("tp.source_kind = 'cell-result'")) {
				return {
					rows: [
						{
							relation_name: 'sales_result',
							last_seen_ms: 1900000000000,
							column_name: 'Category',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 9,
							sample_values_json: '["Snacks"]'
						},
						{
							relation_name: 'sales_result',
							last_seen_ms: 1900000000000,
							column_name: 'Item Name',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name',
							semantic_confidence: 0.88,
							null_ratio: 0.01,
							distinct_count: 150,
							sample_values_json: '["Mango Juice"]'
						},
						{
							relation_name: 'sales_result',
							last_seen_ms: 1900000000000,
							column_name: 'Price (GHS)',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.93,
							null_ratio: 0,
							distinct_count: 80,
							sample_values_json: '["10.0"]'
						}
					],
					columns: [
						'relation_name',
						'last_seen_ms',
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return { rows: [], columns: [] };
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'iris' }],
			availableColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width', 'species']
		});

		expect(chips.length).toBeGreaterThan(0);
		expect(chips.some((chip) => /category|item name|revenue|customer type/i.test(chip.label))).toBe(
			false
		);
		expect(chips.some((chip) => /species|sepal|petal/i.test(chip.label))).toBe(true);
	});

	it('hydrates preset labels from available columns when profile rows are missing', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'since23' }],
			availableColumns: ['Completion Time', 'Paid In', 'Withdrawn', 'Details', 'Payee']
		});

		const hydratedPreset = presets.find(
			(preset) =>
				preset.preset.label.includes('Paid In') || preset.preset.label.includes('Withdrawn')
		);
		expect(hydratedPreset).toBeDefined();
		expect(hydratedPreset?.reasons[0]).toMatch(/Paid In|Withdrawn/);
	});

	it('hydrates multi-column group labels with relevance-thresholded dimensions', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'group', usage_count: 18 },
						{ next_stage: 'sort', usage_count: 15 },
						{ next_stage: 'take', usage_count: 12 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'region',
							data_kind: 'text',
							semantic_type: 'region',
							semantic_signature: 'kind=text|semantic=region|shape=mixed|confidence=high',
							semantic_confidence: 0.92,
							null_ratio: 0.01,
							distinct_count: 8,
							sample_values_json: '["EMEA","NA"]'
						},
						{
							column_name: 'product',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category|shape=mixed|confidence=high',
							semantic_confidence: 0.89,
							null_ratio: 0.03,
							distinct_count: 35,
							sample_values_json: '["A","B"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float|confidence=high',
							semantic_confidence: 0.93,
							null_ratio: 0.02,
							distinct_count: 220,
							sample_values_json: '["100.0","240.0"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['region', 'product', 'amount', 'event_time']
		});

		const grouped = presets.find(
			(preset) =>
				/region \+ product/i.test(preset.preset.label) ||
				/by region \+ product/i.test(preset.preset.label)
		);
		expect(grouped).toBeDefined();
	});

	it('includes extended preset families in intelligent ranking when schema supports them', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 14 },
						{ next_stage: 'group', usage_count: 19 },
						{ next_stage: 'sort', usage_count: 16 },
						{ next_stage: 'take', usage_count: 11 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'event_time',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at',
							semantic_confidence: 0.9,
							null_ratio: 0.01,
							distinct_count: 360,
							sample_values_json: '["2026-01-01"]'
						},
						{
							column_name: 'region',
							data_kind: 'text',
							semantic_type: 'region',
							semantic_signature: 'kind=text|semantic=region',
							semantic_confidence: 0.88,
							null_ratio: 0.03,
							distinct_count: 6,
							sample_values_json: '["EMEA"]'
						},
						{
							column_name: 'product',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.87,
							null_ratio: 0.02,
							distinct_count: 40,
							sample_values_json: '["A"]'
						},
						{
							column_name: 'status',
							data_kind: 'text',
							semantic_type: 'status',
							semantic_signature: 'kind=text|semantic=status',
							semantic_confidence: 0.86,
							null_ratio: 0.01,
							distinct_count: 5,
							sample_values_json: '["won"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.92,
							null_ratio: 0.01,
							distinct_count: 320,
							sample_values_json: '["120.0"]'
						},
						{
							column_name: 'revenue',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.9,
							null_ratio: 0.01,
							distinct_count: 310,
							sample_values_json: '["200.0"]'
						},
						{
							column_name: 'cost',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.9,
							null_ratio: 0.01,
							distinct_count: 300,
							sample_values_json: '["90.0"]'
						},
						{
							column_name: 'customer_id',
							data_kind: 'text',
							semantic_type: 'foreign_key',
							semantic_signature: 'kind=text|semantic=foreign_key',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 1200,
							sample_values_json: '["c1"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'events' }],
			availableColumns: [
				'event_time',
				'region',
				'product',
				'status',
				'amount',
				'revenue',
				'cost',
				'customer_id'
			]
		});

		expect(presets.length).toBeGreaterThan(0);
		expect(
			presets.some((preset) =>
				[
					'hierarchical-rollup',
					'period-variance',
					'segment-anomaly',
					'efficiency-lens',
					'drift-monitor'
				].includes(preset.preset.id)
			)
		).toBe(true);
	});

	it('applies adaptive relevance threshold to avoid low-quality dimensions in multi-column labels', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [{ next_stage: 'group', usage_count: 20 }],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'region',
							data_kind: 'text',
							semantic_type: 'region',
							semantic_signature: 'kind=text|semantic=region',
							semantic_confidence: 0.92,
							null_ratio: 0.01,
							distinct_count: 8,
							sample_values_json: '["NA"]'
						},
						{
							column_name: 'product',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.9,
							null_ratio: 0.03,
							distinct_count: 40,
							sample_values_json: '["A"]'
						},
						{
							column_name: 'notes_blob',
							data_kind: 'text',
							semantic_type: 'description',
							semantic_signature: 'kind=text|semantic=description',
							semantic_confidence: 0.4,
							null_ratio: 0.87,
							distinct_count: 2800,
							sample_values_json: '["long free form"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.93,
							null_ratio: 0.02,
							distinct_count: 200,
							sample_values_json: '["100"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['region', 'product', 'notes_blob', 'amount']
		});

		const rollup = presets.find((preset) => preset.preset.id === 'hierarchical-rollup');
		expect(rollup?.preset.label).toMatch(/region \+ product/i);
		expect(rollup?.preset.label).not.toContain('notes_blob');
	});

	it('humanizes raw column names in hydrated preset labels', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [{ next_stage: 'sort', usage_count: 10 }],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'scraped_at',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at',
							semantic_confidence: 0.91,
							null_ratio: 0.01,
							distinct_count: 120,
							sample_values_json: '["2026-05-01"]'
						},
						{
							column_name: 'total_scraped_at',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.93,
							null_ratio: 0.01,
							distinct_count: 88,
							sample_values_json: '["23.1"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'scrapes' }],
			availableColumns: ['scraped_at', 'total_scraped_at']
		});

		const trend = presets.find((preset) => preset.preset.id === 'temporal-trend');
		const seasonal = presets.find((preset) => preset.preset.id === 'seasonal-pattern');
		expect(presets.some((preset) => preset.preset.label === 'Temporal trend rollup')).toBe(false);
		expect(presets.some((preset) => preset.preset.label === 'Seasonal pattern detector')).toBe(
			false
		);

		if (trend) {
			expect(trend.preset.label).toContain('Monthly');
			expect(trend.preset.label).toContain('Scraped At');
			expect(trend.preset.label).not.toBe('Temporal trend rollup');
			expect(trend.stages.length).toBeGreaterThanOrEqual(5);
			expect(
				trend.stages.some(
					(stage) =>
						stage.type === 'derive' &&
						stage.columns.some(
							(column) => column.name === 'mom_delta' || column.name === 'mom_growth_pct'
						)
				)
			).toBe(true);
		}

		if (seasonal) {
			expect(seasonal.preset.label).not.toBe('Seasonal pattern detector');
			expect(seasonal.stages.length).toBeGreaterThanOrEqual(5);
		}
	});

	it('suppresses weak generic temporal and seasonal presets when required signals are missing', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'job_title',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 900,
							sample_values_json: '["Data Analyst"]'
						},
						{
							column_name: 'role_category',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.85,
							null_ratio: 0.03,
							distinct_count: 14,
							sample_values_json: '["Data"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'links.opportunities' }],
			availableColumns: ['job_title', 'role_category']
		});

		expect(presets.some((preset) => preset.preset.label === 'Temporal trend rollup')).toBe(false);
		expect(presets.some((preset) => preset.preset.label === 'Seasonal pattern detector')).toBe(
			false
		);
		expect(presets.some((preset) => preset.preset.label === 'Drift monitor')).toBe(false);
	});

	it('chooses sensible quick chips for a text-heavy jobs schema', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return { rows: [], columns: [] };
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'links.opportunities' }],
			availableColumns: [
				'job_title',
				'role_category',
				'domain_tags',
				'application_deadline',
				'scraped_at'
			]
		});

		const sortChip = chips.find((chip) => chip.icon === 'sort');
		expect(sortChip?.label).toMatch(/Application Deadline|Scraped At/);
		expect(sortChip?.label).not.toContain('application_deadline');
		expect(sortChip?.label).not.toContain('scraped_at');

		const filterChip = chips.find((chip) => chip.icon === 'filter');
		expect(filterChip?.label).toMatch(/Role Category|Domain Tags/);

		const groupChip = chips.find((chip) => chip.icon === 'group');
		expect(groupChip?.label.toLowerCase()).toContain('count rows');
		expect(groupChip?.label).not.toContain('sum scraped_at');
	});

	it('prioritizes genre-like dimensions over near-unique names for music schemas', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'updated_at',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at',
							semantic_confidence: 0.91,
							null_ratio: 0,
							distinct_count: 66,
							sample_values_json: '["2026-05-30"]'
						},
						{
							column_name: 'name',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name',
							semantic_confidence: 0.92,
							null_ratio: 0,
							distinct_count: 64,
							sample_values_json: '["Track A","Track B"]'
						},
						{
							column_name: 'genre',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.87,
							null_ratio: 0,
							distinct_count: 8,
							sample_values_json: '["Afro House","Amapiano"]'
						},
						{
							column_name: 'sub_genre',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.84,
							null_ratio: 0.02,
							distinct_count: 12,
							sample_values_json: '["Deep House","Log Drum"]'
						},
						{
							column_name: 'mood',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.8,
							null_ratio: 0.05,
							distinct_count: 7,
							sample_values_json: '["Energetic","Calm"]'
						},
						{
							column_name: 'bpm',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.76,
							null_ratio: 0,
							distinct_count: 40,
							sample_values_json: '["120","128"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'beats_copy' }],
			availableColumns: [
				'created_at',
				'updated_at',
				'name',
				'slug',
				'description',
				'bpm',
				'key',
				'genre',
				'sub_genre',
				'mood',
				'user_id',
				'release_date',
				'free_download'
			]
		});

		const filterChip = chips.find((chip) => chip.icon === 'filter');
		expect(filterChip?.label).toContain('Genre');

		const groupChip = chips.find((chip) => chip.icon === 'group');
		expect(groupChip?.label).toContain('Genre');
		expect(groupChip?.label).toContain('Bpm');
		expect(groupChip?.label).not.toContain('Group by Name');

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'beats_copy' }],
			availableColumns: [
				'created_at',
				'updated_at',
				'name',
				'slug',
				'description',
				'bpm',
				'key',
				'genre',
				'sub_genre',
				'mood',
				'user_id',
				'release_date',
				'free_download'
			]
		});

		expect(presets.some((preset) => preset.preset.label.includes('(Bpm/Bpm)'))).toBe(false);
	});

	it('prefers class dimensions over numeric feature dimensions for iris-like schemas', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'sepal_length',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 35,
							sample_values_json: '["5.1"]'
						},
						{
							column_name: 'sepal_width',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 23,
							sample_values_json: '["3.5"]'
						},
						{
							column_name: 'petal_length',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 43,
							sample_values_json: '["1.4"]'
						},
						{
							column_name: 'petal_width',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.89,
							null_ratio: 0,
							distinct_count: 22,
							sample_values_json: '["0.2"]'
						},
						{
							column_name: 'species',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 3,
							sample_values_json: '["setosa"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'iris' }],
			availableColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width', 'species']
		});

		const groupChip = chips.find((chip) => chip.stage.type === 'group');
		expect(groupChip).toBeDefined();
		expect(groupChip?.label.toLowerCase()).toContain('species');
		expect(groupChip?.label.toLowerCase()).not.toContain('sepal length by sepal width');
	});

	it('treats camelCase *Id columns as identifiers and avoids sum collectionId suggestions', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return { rows: [], columns: [] };
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'events' }],
			availableColumns: ['type', 'collectionId', 'updatedAt']
		});

		const groupChip = chips.find(
			(chip) =>
				chip.icon === 'group' &&
				chip.stage.type === 'group' &&
				chip.stage.aggregations[0]?.func === 'count'
		);
		expect(groupChip).toBeDefined();
		expect(groupChip?.label.toLowerCase()).toContain('count rows');
		expect(groupChip?.label.toLowerCase()).not.toContain('sum collectionid');
		if (groupChip?.stage.type === 'group') {
			expect(groupChip.stage.aggregations[0]?.func).toBe('count');
			expect(groupChip.stage.aggregations[0]?.column).toBe('');
		}
	});

	it('does not suggest stage types already present in pipeline', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'updated_at',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at|shape=iso-date|confidence=high',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 100,
							sample_values_json: '["2026-05-01","2026-05-30"]'
						},
						{
							column_name: 'status',
							data_kind: 'text',
							semantic_type: 'status',
							semantic_signature: 'kind=text|semantic=status|shape=mixed|confidence=high',
							semantic_confidence: 0.85,
							null_ratio: 0,
							distinct_count: 3,
							sample_values_json: '["open","closed"]'
						}
					],
					columns: [
						'column_name',
						'data_kind',
						'semantic_type',
						'semantic_signature',
						'semantic_confidence',
						'null_ratio',
						'distinct_count',
						'sample_values_json'
					]
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [
				{ type: 'from', table: 'orders' },
				{ type: 'sort', keys: [{ column: 'updated_at', dir: 'desc' }] },
				{
					type: 'filter',
					conditions: [{ column: 'status', op: '==', value: 'open' }],
					logic: 'and'
				}
			],
			availableColumns: ['updated_at', 'status', 'amount']
		});

		expect(chips.some((chip) => chip.icon === 'sort')).toBe(false);
		expect(chips.some((chip) => chip.icon === 'filter')).toBe(false);
	});

	it('avoids constant status dimensions for filter and group chips', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes("tp.source_kind = 'cell-result'")) {
				return {
					rows: [
						{
							relation_name: 'since23',
							last_seen_ms: 1900000001000,
							column_name: 'Completion Time',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at|shape=iso-date',
							semantic_confidence: 0.92,
							null_ratio: 0,
							distinct_count: 364,
							sample_values_json: '["2026-03-18","2026-03-17"]'
						},
						{
							relation_name: 'since23',
							last_seen_ms: 1900000001000,
							column_name: 'Transaction Status',
							data_kind: 'text',
							semantic_type: 'status',
							semantic_signature: 'kind=text|semantic=status|shape=mixed',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 1,
							sample_values_json: '["Completed"]'
						},
						{
							relation_name: 'since23',
							last_seen_ms: 1900000001000,
							column_name: 'Withdrawn',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float',
							semantic_confidence: 0.95,
							null_ratio: 0.1,
							distinct_count: 645,
							sample_values_json: '["-20.00","-1,492.00","-7.00"]'
						},
						{
							relation_name: 'since23',
							last_seen_ms: 1900000001000,
							column_name: 'Balance',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount|shape=float',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 3997,
							sample_values_json: '["550.87","1,545.87","10,000.00"]'
						}
					],
					columns: []
				};
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return { rows: [], columns: [] };
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'since23' }],
			availableColumns: [
				'Completion Time',
				'Transaction Status',
				'Paid In',
				'Withdrawn',
				'Balance',
				'Details',
				'Payee'
			]
		});

		expect(
			chips.some(
				(chip) =>
					chip.label.includes('Filter by Transaction Status') ||
					chip.label.includes('Group by Transaction Status')
			)
		).toBe(false);
		expect(chips.some((chip) => chip.label.includes('Completion Time'))).toBe(true);
		expect(chips.length).toBeGreaterThanOrEqual(4);
	});

	it('uses unqualified metadata profiles for schema-qualified from sources', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes("tp.source_kind = 'cell-result'")) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				expect(sql).toContain('relation_name IN');
				expect(sql).toContain("'main.since23'");
				expect(sql).toContain("'since23'");
				return {
					rows: [
						{
							column_name: 'Completion Time',
							data_kind: 'date',
							semantic_type: 'updated_at',
							semantic_signature: 'kind=date|semantic=updated_at|shape=iso-date',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 250,
							sample_values_json: '["2026-03-18","2026-03-17"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'main.since23' }],
			availableColumns: []
		});

		expect(chips.some((chip) => chip.label.includes('Completion Time'))).toBe(true);
	});

	it('does not fail when context signatures are empty', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('AND ()')) {
				throw new Error('invalid empty context predicate');
			}
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes("tp.source_kind = 'cell-result'")) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Transaction Status',
							data_kind: 'text',
							semantic_type: 'status',
							semantic_signature: 'kind=text|semantic=status|shape=mixed',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 1,
							sample_values_json: '["Completed"]'
						}
					],
					columns: []
				};
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			return { rows: [], columns: [] };
		});

		await expect(
			getIntelligentQuickChips({
				connectionId: 'builtin.duckdb',
				stages: [{ type: 'from', table: 'since23' }],
				availableColumns: []
			})
		).resolves.toBeDefined();
	});

	it('recommends chart types using semantic intelligence signals', () => {
		const recommendations = recommendIntelligentChartTypes({
			columns: ['event_date', 'category', 'amount', 'collectionId'],
			rows: [
				{ event_date: '2026-05-01', category: 'A', amount: 10.5, collectionId: 1 },
				{ event_date: '2026-05-02', category: 'B', amount: 20.1, collectionId: 2 },
				{ event_date: '2026-05-03', category: 'A', amount: 15.0, collectionId: 3 }
			]
		});

		expect(recommendations.length).toBeGreaterThan(0);
		expect(recommendations[0]?.chartType).toBe('line');
		expect(recommendations.some((entry) => entry.chartType === 'bar')).toBe(true);
		expect(recommendations.some((entry) => entry.chartType === 'area')).toBe(true);
	});

	it('returns multi-column binding hints for temporal and multi-metric signatures', () => {
		const recommendations = recommendIntelligentChartTypes({
			columns: ['event_date', 'region', 'revenue', 'cost', 'margin'],
			rows: [
				{ event_date: '2026-05-01', region: 'East', revenue: 110, cost: 80, margin: 30 },
				{ event_date: '2026-05-02', region: 'West', revenue: 130, cost: 90, margin: 40 },
				{ event_date: '2026-05-03', region: 'East', revenue: 90, cost: 70, margin: 20 }
			]
		});

		expect(recommendations.length).toBeGreaterThan(0);
		expect(recommendations[0]?.signature).toContain('T-');
		expect(recommendations[0]?.xColumn).toBe('event_date');
		expect(recommendations[0]?.yColumns?.length ?? 0).toBeGreaterThan(0);
		expect(recommendations.some((entry) => entry.chartType === 'line')).toBe(true);
		expect(
			recommendations.some((entry) => entry.chartType === 'bubble' || entry.chartType === 'scatter')
		).toBe(true);
	});

	it('uses low-cardinality dimension on x and secondary dimension as color for 2D+1M', () => {
		const recommendations = recommendIntelligentChartTypes({
			columns: ['city', 'property_type', 'sum_rent_usd'],
			rows: [
				{ city: 'Nairobi', property_type: 'Office', sum_rent_usd: 4100 },
				{ city: 'Nakuru', property_type: 'Warehouse', sum_rent_usd: 4800 },
				{ city: 'Mombasa', property_type: 'Retail', sum_rent_usd: 2100 },
				{ city: 'Kampala', property_type: 'Office', sum_rent_usd: 3200 },
				{ city: 'Kigali', property_type: 'Office', sum_rent_usd: 2950 },
				{ city: 'Addis Ababa', property_type: 'Warehouse', sum_rent_usd: 5300 },
				{ city: 'Dar es Salaam', property_type: 'Office', sum_rent_usd: 2750 },
				{ city: 'Lusaka', property_type: 'Retail', sum_rent_usd: 1800 }
			]
		});

		expect(recommendations[0]?.chartType).toBe('bar');
		expect(recommendations[0]?.xColumn).toBe('property_type');
		expect(recommendations[0]?.colorColumn).toBe('city');
		expect(recommendations[0]?.seriesMode).toBe('grouped');
		expect(recommendations[0]?.yColumns).toEqual(['sum_rent_usd']);
	});

	it('prefers a trend chart for temporal category metric shapes', () => {
		const recommendations = recommendIntelligentChartTypes({
			columns: ['mt', 'role_category', 'total_jobs'],
			days: undefined as never,
			rows: [
				{ mt: '2026-05-01', role_category: 'Data Platform / DataOps', total_jobs: 13 },
				{ mt: '2026-05-01', role_category: 'Data Architecture', total_jobs: 4 },
				{ mt: '2026-05-01', role_category: 'MLOps / ML Engineering', total_jobs: 4 },
				{ mt: '2026-05-01', role_category: 'Data Engineering (General)', total_jobs: 13 },
				{ mt: '2026-05-01', role_category: 'Analytics Engineering', total_jobs: 7 },
				{ mt: '2026-05-01', role_category: 'Streaming / Realtime', total_jobs: 7 },
				{ mt: '2026-06-01', role_category: 'Data Platform / DataOps', total_jobs: 15 },
				{ mt: '2026-06-01', role_category: 'Data Architecture', total_jobs: 5 }
			]
		} as never);

		expect(recommendations[0]?.chartType).toBe('line');
		expect(recommendations[0]?.xColumn).toBe('mt');
		expect(recommendations[0]?.colorColumn).toBe('role_category');
		expect(recommendations.map((entry) => entry.chartType)).toContain('bar');
	});

	it('includes stacked bar alternative for 2D+2M signatures', () => {
		const recommendations = recommendIntelligentChartTypes({
			columns: ['city', 'property_type', 'sum_rent_usd', 'avg_deposit_usd'],
			rows: [
				{ city: 'Nairobi', property_type: 'Office', sum_rent_usd: 4100, avg_deposit_usd: 1900 },
				{ city: 'Nakuru', property_type: 'Warehouse', sum_rent_usd: 4800, avg_deposit_usd: 2100 },
				{ city: 'Mombasa', property_type: 'Retail', sum_rent_usd: 2100, avg_deposit_usd: 980 },
				{ city: 'Kampala', property_type: 'Office', sum_rent_usd: 3200, avg_deposit_usd: 1500 },
				{ city: 'Kigali', property_type: 'Office', sum_rent_usd: 2950, avg_deposit_usd: 1430 },
				{
					city: 'Addis Ababa',
					property_type: 'Warehouse',
					sum_rent_usd: 5300,
					avg_deposit_usd: 2600
				}
			]
		});

		const stacked = recommendations.find(
			(entry) => entry.chartType === 'bar' && entry.seriesMode === 'stacked'
		);
		expect(stacked).toBeDefined();
		expect(stacked?.xColumn).toBe('property_type');
		expect(stacked?.colorColumn).toBe('city');
	});

	it('persists exhaustive signatures including semantic and quad patterns', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.semantic_synonyms')) {
				return { rows: [], columns: ['token', 'canonical', 'semantic_hint', 'weight'] };
			}
			return { rows: [], columns: [] };
		});

		await recordCellExecutionMetadata({
			runId: 'run-exhaustive-signatures',
			notebookId: 'nb-1',
			cellId: 'cell-1',
			connectionId: 'builtin.duckdb',
			status: 'success',
			runtimeMs: 20,
			rowCount: 3,
			columnCount: 4,
			tablesTouched: ['events'],
			resultColumns: ['updatedAt', 'type', 'amount', 'collectionId'],
			resultRows: [
				{ updatedAt: '2026-05-30', type: 'OPEN', amount: 10.5, collectionId: 1 },
				{ updatedAt: '2026-05-29', type: 'CLOSED', amount: 20.1, collectionId: 2 },
				{ updatedAt: '2026-05-28', type: 'PENDING', amount: 30.0, collectionId: 3 }
			],
			outputName: 'result_exhaustive',
			stages: [{ type: 'from', table: 'events' }]
		});

		expect(executeSQLMock).toHaveBeenCalledWith(
			expect.stringContaining('signature_type, signature_key')
		);
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining("'quad'"));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('semantic-triplet'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining("'lexical'"));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining("'derive'"));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('pattern=temporal_metric'));
	});

	it('persists derive-intent composed signatures for blind schemas', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.semantic_synonyms')) {
				return { rows: [], columns: ['token', 'canonical', 'semantic_hint', 'weight'] };
			}
			return { rows: [], columns: [] };
		});

		await recordCellExecutionMetadata({
			runId: 'run-derive-signatures',
			notebookId: 'nb-1',
			cellId: 'cell-2',
			connectionId: 'builtin.duckdb',
			status: 'success',
			runtimeMs: 42,
			rowCount: 3,
			columnCount: 4,
			tablesTouched: ['wg'],
			resultColumns: ['Date Sold', 'Category', 'Price (GHS)', 'Units Sold'],
			resultRows: [
				{ 'Date Sold': '2026-05-30', Category: 'Snacks', 'Price (GHS)': 10.5, 'Units Sold': 2 },
				{ 'Date Sold': '2026-05-29', Category: 'Drinks', 'Price (GHS)': 8.2, 'Units Sold': 4 },
				{ 'Date Sold': '2026-05-28', Category: 'Staples', 'Price (GHS)': 12.0, 'Units Sold': 3 }
			],
			outputName: 'wg_result',
			stages: [{ type: 'from', table: 'wg' }]
		});

		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining("'derive'"));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('pattern=composed_metric'));
		expect(executeSQLMock).toHaveBeenCalledWith(expect.stringContaining('pattern=segment_metric'));
	});

	it('falls back to count rows when metric evidence is weak', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'region',
							data_kind: 'text',
							semantic_type: 'region',
							semantic_signature: 'kind=text|semantic=region',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 8,
							sample_values_json: '["EMEA","NA"]'
						},
						{
							column_name: 'value_guess',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.08,
							null_ratio: 0.65,
							distinct_count: 2,
							sample_values_json: '["1","2"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const chips = await getIntelligentQuickChips({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['region', 'value_guess']
		});

		const groupChip = chips.find((chip) => chip.stage.type === 'group');
		expect(groupChip).toBeDefined();
		expect(groupChip?.label.toLowerCase()).toContain('count rows');
		expect(groupChip?.label.toLowerCase()).not.toContain('sum value guess');
		if (groupChip?.stage.type === 'group') {
			expect(groupChip.stage.aggregations[0]?.func).toBe('count');
		}
	});

	it('keeps top-metric preset focused on strong metric columns', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [{ next_stage: 'sort', usage_count: 9 }],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'region',
							data_kind: 'text',
							semantic_type: 'region',
							semantic_signature: 'kind=text|semantic=region',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 7,
							sample_values_json: '["EMEA"]'
						},
						{
							column_name: 'customer_id',
							data_kind: 'numeric',
							semantic_type: 'id',
							semantic_signature: 'kind=numeric|semantic=id',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 1200,
							sample_values_json: '["1","2"]'
						},
						{
							column_name: 'amount',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.9,
							null_ratio: 0.01,
							distinct_count: 220,
							sample_values_json: '["100.0","220.0"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'orders' }],
			availableColumns: ['region', 'customer_id', 'amount']
		});

		const topMetric = presets.find((preset) => preset.preset.id === 'top-metric');
		expect(topMetric).toBeDefined();
		expect(topMetric?.preset.label).toContain('amount');
		expect(topMetric?.preset.label).not.toContain('customer_id');
	});

	it('scopes bundle suggestions to currently selected columns', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 11 },
						{ next_stage: 'group', usage_count: 10 },
						{ next_stage: 'sort', usage_count: 9 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Scraped At',
							data_kind: 'date',
							semantic_type: 'event_time',
							semantic_signature: 'kind=date|semantic=event_time',
							semantic_confidence: 0.92,
							null_ratio: 0,
							distinct_count: 320,
							sample_values_json: '["2026-05-31"]'
						},
						{
							column_name: 'Job Title',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 120,
							sample_values_json: '["Data Engineer"]'
						},
						{
							column_name: 'Company Name',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.86,
							null_ratio: 0,
							distinct_count: 90,
							sample_values_json: '["Acme"]'
						},
						{
							column_name: 'Experience',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.84,
							null_ratio: 0.05,
							distinct_count: 20,
							sample_values_json: '["3","5"]'
						},
						{
							column_name: 'Relevance Score',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.97,
							null_ratio: 0,
							distinct_count: 300,
							sample_values_json: '["0.99","0.21"]'
						},
						{
							column_name: 'Job Type',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.93,
							null_ratio: 0,
							distinct_count: 5,
							sample_values_json: '["Full-time"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [
				{ type: 'from', table: 'de_opportunities' },
				{ type: 'select', columns: ['Scraped At', 'Job Title', 'Company Name', 'Experience'] }
			],
			availableColumns: ['Scraped At', 'Job Title', 'Company Name', 'Experience']
		});

		const topMetric = presets.find((preset) => preset.preset.id === 'top-metric');
		expect(topMetric).toBeDefined();
		expect(topMetric?.preset.label).toContain('Experience');
		expect(JSON.stringify(presets)).not.toContain('Relevance Score');
		expect(JSON.stringify(presets)).not.toContain('Job Type');
	});

	it('suggests composed revenue bundles for price and quantity schemas', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 14 },
						{ next_stage: 'group', usage_count: 16 },
						{ next_stage: 'sort', usage_count: 12 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Item Name',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name',
							semantic_confidence: 0.9,
							null_ratio: 0.02,
							distinct_count: 120,
							sample_values_json: '["Apple"]'
						},
						{
							column_name: 'Category',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.92,
							null_ratio: 0.01,
							distinct_count: 9,
							sample_values_json: '["Snacks"]'
						},
						{
							column_name: 'Price (GHS)',
							data_kind: 'numeric',
							semantic_type: 'amount',
							semantic_signature: 'kind=numeric|semantic=amount',
							semantic_confidence: 0.94,
							null_ratio: 0.0,
							distinct_count: 80,
							sample_values_json: '["10.00"]'
						},
						{
							column_name: 'Units Sold',
							data_kind: 'numeric',
							semantic_type: 'quantity',
							semantic_signature: 'kind=numeric|semantic=quantity',
							semantic_confidence: 0.93,
							null_ratio: 0.0,
							distinct_count: 25,
							sample_values_json: '["2"]'
						},
						{
							column_name: 'Date Sold',
							data_kind: 'date',
							semantic_type: 'date',
							semantic_signature: 'kind=date|semantic=date',
							semantic_confidence: 0.9,
							null_ratio: 0.0,
							distinct_count: 365,
							sample_values_json: '["2026-05-01"]'
						},
						{
							column_name: 'Location',
							data_kind: 'text',
							semantic_type: 'region',
							semantic_signature: 'kind=text|semantic=region',
							semantic_confidence: 0.85,
							null_ratio: 0.02,
							distinct_count: 7,
							sample_values_json: '["Accra"]'
						},
						{
							column_name: 'Customer Type',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.84,
							null_ratio: 0.01,
							distinct_count: 2,
							sample_values_json: '["Walk-in"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'wg' }],
			availableColumns: [
				'Item Name',
				'Category',
				'Price (GHS)',
				'Units Sold',
				'Date Sold',
				'Location',
				'Customer Type'
			]
		});

		const groupTop = presets.find((preset) => preset.preset.id === 'group-top');
		expect(groupTop).toBeDefined();
		expect(
			groupTop?.stages.some(
				(stage) =>
					stage.type === 'derive' && stage.columns.some((column) => column.name === 'revenue')
			)
		).toBe(true);
		expect(
			groupTop?.stages.some(
				(stage) =>
					stage.type === 'group' &&
					stage.aggregations.some(
						(aggregation) => aggregation.name === 'sum_revenue' && aggregation.column === 'revenue'
					)
			)
		).toBe(true);

		const temporal = presets.find((preset) => preset.preset.id === 'temporal-trend');
		expect(temporal).toBeDefined();
		expect(
			temporal?.stages.some(
				(stage) =>
					stage.type === 'derive' && stage.columns.some((column) => column.name === 'revenue')
			)
		).toBe(true);
	});

	it('surfaces cashflow and text presets for output.csv-like transaction schemas', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 18 },
						{ next_stage: 'group', usage_count: 16 },
						{ next_stage: 'sort', usage_count: 14 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Receipt No.',
							data_kind: 'text',
							semantic_type: 'code',
							semantic_signature: 'kind=text|semantic=code',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 1200,
							sample_values_json: '["UCIII9QXAY"]'
						},
						{
							column_name: 'Completion Time',
							data_kind: 'text',
							semantic_type: 'event_time',
							semantic_signature: 'kind=text|semantic=event_time',
							semantic_confidence: 0.93,
							null_ratio: 0,
							distinct_count: 1200,
							sample_values_json: '["2026-03-18 10:26:39"]'
						},
						{
							column_name: 'Details',
							data_kind: 'text',
							semantic_type: 'description',
							semantic_signature: 'kind=text|semantic=description',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 1100,
							sample_values_json: '["Merchant Payment Online"]'
						},
						{
							column_name: 'Transaction Status',
							data_kind: 'text',
							semantic_type: 'status',
							semantic_signature: 'kind=text|semantic=status',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 3,
							sample_values_json: '["Completed"]'
						},
						{
							column_name: 'Paid In',
							data_kind: 'text',
							semantic_type: 'inflow',
							semantic_signature: 'kind=text|semantic=inflow',
							semantic_confidence: 0.84,
							null_ratio: 0.75,
							distinct_count: 300,
							sample_values_json: '["200.0"]'
						},
						{
							column_name: 'Withdrawn',
							data_kind: 'text',
							semantic_type: 'outflow',
							semantic_signature: 'kind=text|semantic=outflow',
							semantic_confidence: 0.9,
							null_ratio: 0.15,
							distinct_count: 580,
							sample_values_json: '["-230.0"]'
						},
						{
							column_name: 'Balance',
							data_kind: 'text',
							semantic_type: 'currency_amount',
							semantic_signature: 'kind=text|semantic=currency_amount',
							semantic_confidence: 0.86,
							null_ratio: 0.03,
							distinct_count: 970,
							sample_values_json: '["550.87"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'mpesa_transactions' }],
			availableColumns: [
				'Receipt No.',
				'Completion Time',
				'Details',
				'Transaction Status',
				'Paid In',
				'Withdrawn',
				'Balance'
			]
		});

		const topIds = presets.slice(0, 7).map((preset) => preset.preset.id);
		expect(topIds).toEqual(
			expect.arrayContaining(['cashflow-rollup', 'temporal-trend', 'text-categorize'])
		);

		const cashflow = presets.find((preset) => preset.preset.id === 'cashflow-rollup');
		expect(cashflow).toBeDefined();
		expect(
			cashflow?.stages.some(
				(stage) =>
					stage.type === 'derive' && stage.columns.some((column) => column.name === 'outflow')
			)
		).toBe(true);
	});

	it('emits hydrated semantic-template bundles with dynamic preset ids', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 15 },
						{ next_stage: 'group', usage_count: 13 },
						{ next_stage: 'sort', usage_count: 11 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Detected At',
							data_kind: 'date',
							semantic_type: 'event_time',
							semantic_signature: 'kind=date|semantic=event_time',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 500,
							sample_values_json: '["2026-05-01 10:10:00"]'
						},
						{
							column_name: 'Downtime Cost USD',
							data_kind: 'numeric',
							semantic_type: 'currency_amount',
							semantic_signature: 'kind=numeric|semantic=currency_amount',
							semantic_confidence: 0.92,
							null_ratio: 0,
							distinct_count: 420,
							sample_values_json: '["1400"]'
						},
						{
							column_name: 'Incident Type',
							data_kind: 'text',
							semantic_type: 'event_type',
							semantic_signature: 'kind=text|semantic=event_type',
							semantic_confidence: 0.87,
							null_ratio: 0,
							distinct_count: 8,
							sample_values_json: '["network"]'
						},
						{
							column_name: 'Incident ID',
							data_kind: 'text',
							semantic_type: 'code',
							semantic_signature: 'kind=text|semantic=code',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 500,
							sample_values_json: '["INC-1"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'cybersec_incidents' }],
			availableColumns: ['Incident ID', 'Detected At', 'Downtime Cost USD', 'Incident Type']
		});

		const templatePreset = presets.find((preset) =>
			preset.preset.id.startsWith('semantic-template-')
		);
		expect(templatePreset).toBeDefined();
		expect(templatePreset?.preset.id).toMatch(/^semantic-template-/);
		expect(templatePreset?.snippet?.prql ?? '').toMatch(
			/Incident Type|Downtime Cost USD|Detected At|Incident ID/
		);
	});

	it('does not treat downtime metrics as temporal axes in preset labels', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 14 },
						{ next_stage: 'group', usage_count: 12 },
						{ next_stage: 'sort', usage_count: 10 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Incident ID',
							data_kind: 'text',
							semantic_type: 'code',
							semantic_signature: 'kind=text|semantic=code',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 500,
							sample_values_json: '["INC-1"]'
						},
						{
							column_name: 'Detected At',
							data_kind: 'text',
							semantic_type: 'event_time',
							semantic_signature: 'kind=text|semantic=event_time',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 500,
							sample_values_json: '["2026-05-01 10:10:00"]'
						},
						{
							column_name: 'Hosts Affected',
							data_kind: 'numeric',
							semantic_type: 'count',
							semantic_signature: 'kind=numeric|semantic=count',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 40,
							sample_values_json: '["6"]'
						},
						{
							column_name: 'Downtime Cost USD',
							data_kind: 'numeric',
							semantic_type: 'currency_amount',
							semantic_signature: 'kind=numeric|semantic=currency_amount',
							semantic_confidence: 0.92,
							null_ratio: 0,
							distinct_count: 420,
							sample_values_json: '["1400"]'
						},
						{
							column_name: 'Severity Level',
							data_kind: 'text',
							semantic_type: 'status',
							semantic_signature: 'kind=text|semantic=status',
							semantic_confidence: 0.85,
							null_ratio: 0,
							distinct_count: 4,
							sample_values_json: '["high"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const presets = await getIntelligentPresetSuggestions({
			connectionId: 'builtin.duckdb',
			stages: [{ type: 'from', table: 'cybersec_incidents' }],
			availableColumns: [
				'Incident ID',
				'Detected At',
				'Hosts Affected',
				'Downtime Cost USD',
				'Severity Level'
			]
		});

		const trend = presets.find((preset) => preset.preset.id === 'temporal-trend');
		expect(trend).toBeDefined();
		expect(trend?.preset.label).toContain('Detected At');
		expect(trend?.preset.label).not.toContain('Downtime Cost USD');
	});

	it('generates syntactically valid intelligent suggestions for spaced identifiers', async () => {
		executeSQLMock.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM _lunapad_metadata.stage_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.stage_sequence_usage')) {
				return {
					rows: [
						{ next_stage: 'derive', usage_count: 12 },
						{ next_stage: 'group', usage_count: 10 },
						{ next_stage: 'sort', usage_count: 9 }
					],
					columns: ['next_stage', 'usage_count']
				};
			}
			if (sql.includes('FROM _lunapad_metadata.signature_usage')) {
				return { rows: [], columns: [] };
			}
			if (sql.includes('FROM _lunapad_metadata.column_profiles')) {
				return {
					rows: [
						{
							column_name: 'Scraped At',
							data_kind: 'date',
							semantic_type: 'event_time',
							semantic_signature: 'kind=date|semantic=event_time',
							semantic_confidence: 0.95,
							null_ratio: 0,
							distinct_count: 320,
							sample_values_json: '["2026-05-31 09:10:00"]'
						},
						{
							column_name: 'Job Level',
							data_kind: 'numeric',
							semantic_type: 'metric',
							semantic_signature: 'kind=numeric|semantic=metric',
							semantic_confidence: 0.88,
							null_ratio: 0,
							distinct_count: 9,
							sample_values_json: '["2","3"]'
						},
						{
							column_name: 'Job Type',
							data_kind: 'text',
							semantic_type: 'category',
							semantic_signature: 'kind=text|semantic=category',
							semantic_confidence: 0.9,
							null_ratio: 0,
							distinct_count: 5,
							sample_values_json: '["Full-time"]'
						},
						{
							column_name: 'Company Name',
							data_kind: 'text',
							semantic_type: 'entity_name',
							semantic_signature: 'kind=text|semantic=entity_name',
							semantic_confidence: 0.87,
							null_ratio: 0,
							distinct_count: 120,
							sample_values_json: '["Acme"]'
						}
					],
					columns: []
				};
			}
			return { rows: [], columns: [] };
		});

		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'de_opportunities' },
			{ type: 'select', columns: ['Scraped At', 'Job Level', 'Job Type', 'Company Name'] }
		];

		const [chips, presets] = await Promise.all([
			getIntelligentQuickChips({
				connectionId: 'builtin.duckdb',
				stages,
				availableColumns: ['Scraped At', 'Job Level', 'Job Type', 'Company Name']
			}),
			getIntelligentPresetSuggestions({
				connectionId: 'builtin.duckdb',
				stages,
				availableColumns: ['Scraped At', 'Job Level', 'Job Type', 'Company Name']
			})
		]);

		const opts = new NodeCompileOptions();
		opts.target = 'sql.duckdb';
		opts.signature_comment = false;
		opts.format = true;

		const isExpectedResolutionError = (error: unknown): boolean => {
			const message = String((error as { message?: string })?.message ?? error);
			try {
				const parsed = JSON.parse(message) as {
					inner?: Array<{ reason?: string }>;
					reason?: string;
				};
				const reasons = parsed.inner?.map((item) => item.reason ?? '') ?? [parsed.reason ?? ''];
				return (
					reasons.length > 0 &&
					reasons.every((reason) => /Unknown name|Unknown table|Unknown relation/i.test(reason))
				);
			} catch {
				return false;
			}
		};

		for (const chip of chips) {
			const prql = guiToPreql([stages[0], chip.stage]);
			try {
				compileNodePrql(prql, opts);
			} catch (error) {
				expect(
					isExpectedResolutionError(error),
					`Chip ${chip.id} produced invalid PRQL:\n${prql}\n${String((error as { message?: string })?.message ?? error)}`
				).toBe(true);
			}
		}

		for (const preset of presets) {
			const prql = guiToPreql([stages[0], ...preset.stages]);
			try {
				compileNodePrql(prql, opts);
			} catch (error) {
				expect(
					isExpectedResolutionError(error),
					`Preset ${preset.preset.id} produced invalid PRQL:\n${prql}\n${String((error as { message?: string })?.message ?? error)}`
				).toBe(true);
			}
		}
	});
});
