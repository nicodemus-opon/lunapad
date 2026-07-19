import { DASHBOARD_ICON_NAMES, isDashboardIconName } from './dashboard-icons';
import { CHART_TYPES, FILTER_KINDS, PICTOGRAM_MAX_ICONS } from './generated-dashboard';
import {
	getComponentCapabilityCatalog,
	type ComponentCapabilityCatalog,
	type ComponentDiagnosticClass
} from './component-capabilities';
import {
	compileNotebookBlueprint,
	type NotebookBlueprint,
	type NotebookBlueprintBlock,
	type NotebookBlueprintDiagnostic
} from './notebook-blueprint';

export type DataAppPrimaryWorkflow =
	| 'monitor'
	| 'explore'
	| 'explain'
	| 'compare'
	| 'edit'
	| 'simulate'
	| 'answer'
	| 'publish';

export interface DataAppIntent {
	goal: string;
	audience?: string;
	primaryWorkflow: DataAppPrimaryWorkflow;
	evaluationLabels: string[];
	userMoves: string[];
	viewNeeds: string[];
	componentIds: string[];
	runtimeContract: string[];
	notes: string[];
}

export interface DataAppPlanResult {
	intent: DataAppIntent;
	dataModel: {
		entities: string[];
		metrics: string[];
		dimensions: string[];
		timeGrains: string[];
		lineage: string[];
		sourceCells: string[];
	};
	interactionModel: string[];
	viewSkeleton: string[];
	runtimeContract: string[];
	componentCatalog: { version: string; hash: string; componentIds: string[] };
	compositionSamples: string[][];
	compileTarget: 'notebook';
	nextTools: string[];
}

export interface RepairLogEntry {
	path: string;
	class: ComponentDiagnosticClass;
	action: string;
	before?: unknown;
	after?: unknown;
}

export interface RepairNotebookBlueprintResult {
	blueprint: NotebookBlueprint;
	repairLog: RepairLogEntry[];
	diagnostics: NotebookBlueprintDiagnostic[];
}

export interface ScoreNotebookBlueprintResult {
	score: number;
	target: 'valid' | 'polished' | 'publication';
	breakdown: Record<string, number>;
	diagnostics: Array<NotebookBlueprintDiagnostic & { class?: ComponentDiagnosticClass }>;
	componentCatalog: { version: string; hash: string };
}

const viewNeedByTerm: Array<[RegExp, string]> = [
	[/dashboard|monitor|ops|kpi|sla|status/i, 'metric'],
	[/infographic|poster|factsheet|report|story|narrative|publication/i, 'narrative'],
	[/chart|trend|forecast|over time|timeseries|distribution/i, 'chart'],
	[/table|list|records|rows|manager|crud/i, 'table'],
	[/filter|slice|segment|drill/i, 'filter'],
	[/simulate|scenario|what if|parameter|control/i, 'control'],
	[/map|geo|region|territory|city|country/i, 'map'],
	[/ask|qa|q&a|answer|chat|question/i, 'answer']
];

const LOCAL_COMPOSITION_ADJACENCY: Record<string, string[]> = {
	metric: ['metric', 'chart', 'table', 'narrative', 'filter'],
	chart: ['table', 'detail_panel', 'narrative', 'filter'],
	table: ['detail_panel', 'filter', 'narrative'],
	filter: ['metric', 'chart', 'table'],
	map: ['metric', 'table', 'narrative'],
	control: ['metric', 'chart', 'table'],
	answer: ['narrative', 'detail_panel'],
	narrative: ['metric', 'chart', 'table', 'detail_panel']
};

function includesAny(text: string, terms: string[]): boolean {
	return terms.some((term) => text.includes(term));
}

function primaryWorkflow(prompt: string): DataAppPrimaryWorkflow {
	const text = prompt.toLowerCase();
	if (includesAny(text, ['simulate', 'simulator', 'scenario', 'what if'])) return 'simulate';
	if (includesAny(text, ['ask', 'q&a', 'answer', 'chat'])) return 'answer';
	if (includesAny(text, ['edit', 'approve', 'manager', 'crud', 'form'])) return 'edit';
	if (includesAny(text, ['compare', 'versus', 'benchmark'])) return 'compare';
	if (includesAny(text, ['explore', 'drill', 'slice', 'investigate'])) return 'explore';
	if (includesAny(text, ['poster', 'infographic', 'report', 'story', 'publish'])) return 'publish';
	return 'monitor';
}

function labelsForPrompt(prompt: string): string[] {
	const text = prompt.toLowerCase();
	const labels = new Set<string>();
	if (includesAny(text, ['dashboard', 'kpi', 'monitor'])) labels.add('dashboard');
	if (includesAny(text, ['infographic', 'poster', 'factsheet', 'report']))
		labels.add('infographic_report');
	if (includesAny(text, ['explore', 'exploratory', 'drill', 'slice'])) labels.add('explorer');
	if (includesAny(text, ['simulate', 'scenario', 'what if'])) labels.add('simulator');
	if (includesAny(text, ['edit', 'approve', 'manager', 'crud'])) labels.add('data_manager');
	if (includesAny(text, ['ask', 'q&a', 'answer', 'chat'])) labels.add('qa');
	return [...labels];
}

function componentIdsForNeeds(needs: string[], catalog: ComponentCapabilityCatalog): string[] {
	const ids = new Set<string>(['text']);
	const available = new Set(catalog.aiAuthorableComponentIds);
	const add = (id: string) => {
		if (available.has(id)) ids.add(id);
	};
	for (const need of needs) {
		if (need === 'metric') add('metric');
		if (need === 'narrative') {
			add('columns');
			add('callout');
			add('details');
		}
		if (need === 'chart') add('chart');
		if (need === 'table') add('datatable');
		if (need === 'filter') add('filter');
		if (need === 'control') {
			add('filter');
			add('metric');
			add('progress');
		}
		if (need === 'map') add('chart');
		if (need === 'answer') {
			add('details');
			add('bookmark');
		}
	}
	return [...ids].filter((id) => available.has(id));
}

export function sampleLocalViewComposition(viewNeeds: string[], beamSize = 3): string[][] {
	const seeds = viewNeeds.length ? viewNeeds : ['metric', 'chart', 'table'];
	const beams: string[][] = [[seeds[0]]];
	for (const need of seeds.slice(1)) {
		const next: string[][] = [];
		for (const beam of beams) {
			const tail = beam[beam.length - 1] ?? 'narrative';
			const allowed = LOCAL_COMPOSITION_ADJACENCY[tail] ?? [];
			if (allowed.includes(need)) {
				next.push([...beam, need]);
			} else {
				const bridge = allowed.find((candidate) => seeds.includes(candidate)) ?? 'narrative';
				next.push([...beam, bridge, need]);
			}
		}
		beams.splice(0, beams.length, ...next.slice(0, beamSize));
	}
	return beams.slice(0, beamSize);
}

export function planNotebookApp(input: {
	prompt: string;
	availableOutputNames?: string[];
	componentCatalog?: ComponentCapabilityCatalog;
}): DataAppPlanResult {
	const catalog = input.componentCatalog ?? getComponentCapabilityCatalog();
	const viewNeeds = viewNeedByTerm
		.filter(([pattern]) => pattern.test(input.prompt))
		.map(([, need]) => need);
	if (!viewNeeds.length) viewNeeds.push('metric', 'chart', 'table');
	const workflow = primaryWorkflow(input.prompt);
	const labels = labelsForPrompt(input.prompt);
	const userMoves = new Set<string>();
	if (['monitor', 'publish'].includes(workflow)) userMoves.add('inspect');
	if (['explore', 'compare'].includes(workflow)) {
		userMoves.add('filter');
		userMoves.add('compare');
	}
	if (workflow === 'simulate') {
		userMoves.add('simulate');
		userMoves.add('compare');
	}
	if (workflow === 'edit') {
		userMoves.add('edit');
		userMoves.add('approve');
	}
	if (workflow === 'answer') {
		userMoves.add('ask');
		userMoves.add('inspect_lineage');
	}
	const componentIds = componentIdsForNeeds(viewNeeds, catalog);
	const runtimeContract = [
		'validate notebook blueprint before mutation',
		'run deterministic repair before rejecting repairable component/layout issues',
		'keep unknown live refs fatal',
		'lineage required for answer surfaces',
		'controls must be wired, downgraded, or removed'
	];
	return {
		intent: {
			goal: input.prompt,
			primaryWorkflow: workflow,
			evaluationLabels: labels,
			userMoves: [...userMoves],
			viewNeeds,
			componentIds,
			runtimeContract,
			notes: ['Labels are evaluation hints only; production planning composes primitives.']
		},
		dataModel: {
			entities: [],
			metrics: [],
			dimensions: [],
			timeGrains: [],
			lineage: input.availableOutputNames ?? [],
			sourceCells: input.availableOutputNames ?? []
		},
		interactionModel: [...userMoves],
		viewSkeleton: viewNeeds.map((need) =>
			need === 'control' ? 'bounded_control' : need === 'answer' ? 'cited_answer_panel' : need
		),
		runtimeContract,
		componentCatalog: {
			version: catalog.version,
			hash: catalog.hash,
			componentIds
		},
		compositionSamples: sampleLocalViewComposition(viewNeeds),
		compileTarget: 'notebook',
		nextTools: [
			'get_component_capabilities',
			'get_notebook_app_grammar',
			'create_notebook',
			'apply_notebook_patch',
			'validate_notebook'
		]
	};
}

function log(
	repairLog: RepairLogEntry[],
	path: string,
	klass: ComponentDiagnosticClass,
	action: string,
	before?: unknown,
	after?: unknown
): void {
	repairLog.push({ path, class: klass, action, before, after });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function repairIcon(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): void {
	if (typeof block.icon === 'string' && !isDashboardIconName(block.icon)) {
		const before = block.icon;
		delete block.icon;
		log(repairLog, `${path}.icon`, 'repairable', 'unknown icon -> removed', before, undefined);
	}
}

const CHARTISH_BLOCK_TYPES = new Set(['plot', 'visualization', 'visualisation', 'viz']);
const LOGIC_BLOCK_TYPE_ALIASES = new Map([
	['if', 'conditional'],
	['when', 'conditional'],
	['forEach', 'each'],
	['foreach', 'each'],
	['repeat', 'each'],
	['loop', 'each']
]);
const TONE_VALUES = new Set(['neutral', 'info', 'success', 'warning', 'error']);

function stringList(value: unknown): string[] | null {
	if (Array.isArray(value)) {
		const values = value.filter(
			(item): item is string => typeof item === 'string' && !!item.trim()
		);
		return values.length ? values : null;
	}
	if (typeof value === 'string' && value.trim()) {
		return value
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return null;
}

function sameStringArray(left: unknown, right: string[]): boolean {
	return (
		Array.isArray(left) &&
		left.length === right.length &&
		left.every((item, index) => item === right[index])
	);
}

function rowsRef(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (/^\$[A-Za-z_]\w*$/.test(trimmed)) return `${trimmed}.rows`;
	return trimmed;
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
	for (const key of keys) {
		if (record[key] !== undefined) return record[key];
	}
	return undefined;
}

function moveAlias(
	block: Record<string, unknown>,
	from: string,
	to: string,
	path: string,
	repairLog: RepairLogEntry[],
	action = `${from} -> ${to}`
): void {
	if (block[to] !== undefined || block[from] === undefined) return;
	block[to] = block[from];
	delete block[from];
	log(repairLog, `${path}.${from}`, 'repairable', action, block[to]);
}

function blocksFromUnknown(
	value: unknown,
	path: string,
	repairLog: RepairLogEntry[]
): NotebookBlueprintBlock[] {
	if (Array.isArray(value)) return repairBlocks(value, path, repairLog);
	if (isRecord(value)) return repairBlock(value, path, repairLog);
	if (typeof value === 'string' && value.trim()) {
		const block = { type: 'text', content: value.trim() };
		log(repairLog, path, 'repairable', 'string content -> text block', value, block);
		return [block as NotebookBlueprintBlock];
	}
	if (value !== undefined) {
		log(repairLog, path, 'downgradable', 'unusable child content -> removed', value);
	}
	return [];
}

function normalizeChildBlocks(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[],
	target = 'blocks'
): void {
	const source = firstDefined(block, ['blocks', 'children', 'childBlocks', 'body', 'content']);
	if (source === undefined) return;
	if (block[target] === undefined || block[target] === source) {
		block[target] = blocksFromUnknown(source, `${path}.${target}`, repairLog);
		if (source !== block[target]) {
			log(repairLog, path, 'repairable', 'child content -> blocks array');
		}
	}
}

function hasExplicitChartEncoding(block: Record<string, unknown>): boolean {
	return !!(
		block.x ||
		block.y ||
		block.yColumns ||
		block.lat ||
		block.lon ||
		block.code ||
		block.xColumn ||
		block.yColumn ||
		block.latColumn ||
		block.lonColumn
	);
}

function repairChartLikeBlock(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): Record<string, unknown> {
	const rawType = block.type;
	if (typeof rawType === 'string' && CHART_TYPES.has(rawType) && rawType !== 'table') {
		const repaired = { ...block, type: 'chart', chartType: block.chartType ?? rawType };
		log(
			repairLog,
			`${path}.type`,
			'repairable',
			'chart type alias -> chart block',
			rawType,
			'chart'
		);
		return repaired;
	}
	if (typeof rawType === 'string' && CHARTISH_BLOCK_TYPES.has(rawType)) {
		const repaired = { ...block, type: 'chart' };
		log(
			repairLog,
			`${path}.type`,
			'repairable',
			'visual block alias -> chart block',
			rawType,
			'chart'
		);
		return repaired;
	}
	if (
		rawType === 'table' &&
		(block.data !== undefined || block.dataRef !== undefined || block.source !== undefined)
	) {
		const repaired = {
			...block,
			type: 'datatable',
			data: rowsRef(block.data ?? block.dataRef ?? block.source)
		};
		log(
			repairLog,
			`${path}.type`,
			'repairable',
			'table block alias -> datatable',
			rawType,
			'datatable'
		);
		return repaired;
	}
	return block;
}

function repairEnumValue(
	block: Record<string, unknown>,
	prop: string,
	allowed: Set<string>,
	fallback: string,
	path: string,
	repairLog: RepairLogEntry[]
): void {
	const value = block[prop];
	if (typeof value === 'string' && !allowed.has(value)) {
		block[prop] = fallback;
		log(repairLog, `${path}.${prop}`, 'repairable', 'invalid enum -> fallback', value, fallback);
	}
}

function repairChartConfig(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): void {
	for (const key of ['chartConfig', 'resultChartConfig']) {
		if (isRecord(block[key])) {
			const before = block[key];
			const config = before as Record<string, unknown>;
			if (!block.chartType && typeof config.type === 'string' && CHART_TYPES.has(config.type)) {
				block.chartType = config.type;
			}
			block = Object.assign(block, { ...config, ...block });
			delete block[key];
			log(repairLog, `${path}.${key}`, 'repairable', 'chart config object -> chart props', before);
		}
	}
	const chartTypeAlias = block.chartKind ?? block.visualType ?? block.plotType ?? block.kind;
	if (!block.chartType && typeof chartTypeAlias === 'string' && CHART_TYPES.has(chartTypeAlias)) {
		block.chartType = chartTypeAlias;
		log(
			repairLog,
			`${path}.chartType`,
			'repairable',
			'chart type alias -> chartType',
			chartTypeAlias,
			block.chartType
		);
	}
	const aliasPairs: Array<[string, string, string]> = [
		['xColumn', 'x', 'xColumn -> x'],
		['yColumn', 'y', 'yColumn -> y'],
		['latitudeColumn', 'lat', 'latitudeColumn -> lat'],
		['latColumn', 'lat', 'latColumn -> lat'],
		['longitudeColumn', 'lon', 'longitudeColumn -> lon'],
		['lngColumn', 'lon', 'lngColumn -> lon'],
		['lonColumn', 'lon', 'lonColumn -> lon'],
		['series', 'colorColumn', 'series -> colorColumn'],
		['color', 'colorColumn', 'color -> colorColumn']
	];
	for (const [from, to, action] of aliasPairs) {
		if (block[to] === undefined && block[from] !== undefined) {
			block[to] = block[from];
			delete block[from];
			log(repairLog, `${path}.${from}`, 'repairable', action, block[to]);
		}
	}
	const yColumns = stringList(block.yColumns);
	if (yColumns && !sameStringArray(block.yColumns, yColumns)) {
		const before = block.yColumns;
		block.yColumns = yColumns;
		log(repairLog, `${path}.yColumns`, 'repairable', 'yColumns -> string array', before, yColumns);
	}
	if (!block.y && yColumns?.length === 1) {
		block.y = yColumns[0];
		log(
			repairLog,
			`${path}.y`,
			'repairable',
			'single yColumns value -> y alias',
			undefined,
			block.y
		);
	}
	for (const key of ['dataRef', 'source', 'rows']) {
		if (block.data === undefined && block[key] !== undefined) {
			const before = block[key];
			block.data = rowsRef(before);
			delete block[key];
			log(repairLog, `${path}.${key}`, 'repairable', `${key} -> data rows`, before, block.data);
		}
	}
	if (block.data !== undefined) {
		const before = block.data;
		const after = rowsRef(before);
		if (after !== before) {
			block.data = after;
			log(repairLog, `${path}.data`, 'repairable', 'cell data ref -> rows ref', before, after);
		}
	}
	if (block.ref !== undefined && block.data === undefined && hasExplicitChartEncoding(block)) {
		const before = block.ref;
		const data = rowsRef(before);
		if (data !== before) {
			block.data = data;
			log(
				repairLog,
				`${path}.ref`,
				'repairable',
				'chart ref with explicit encoding -> data rows',
				before,
				data
			);
		}
	}
}

function repairDatatableConfig(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): void {
	for (const key of ['dataRef', 'source', 'rows']) {
		if (block.data === undefined && block[key] !== undefined) {
			const before = block[key];
			block.data = rowsRef(before);
			delete block[key];
			log(repairLog, `${path}.${key}`, 'repairable', `${key} -> data rows`, before, block.data);
		}
	}
	if (block.data !== undefined) {
		const before = block.data;
		const after = rowsRef(before);
		if (after !== before) {
			block.data = after;
			log(repairLog, `${path}.data`, 'repairable', 'cell data ref -> rows ref', before, after);
		}
	}
	const cols = stringList(block.cols);
	if (cols && !sameStringArray(block.cols, cols)) {
		const before = block.cols;
		block.cols = cols;
		log(repairLog, `${path}.cols`, 'repairable', 'cols -> string array', before, cols);
	}
}

function templateFromUnknown(
	value: unknown,
	fallback: string,
	path: string,
	repairLog: RepairLogEntry[]
): string {
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (Array.isArray(value)) {
		const rendered = value
			.map((item) => {
				if (typeof item === 'string') return item.trim();
				if (isRecord(item) && typeof item.content === 'string') return item.content.trim();
				if (isRecord(item) && typeof item.template === 'string') return item.template.trim();
				return '';
			})
			.filter(Boolean)
			.join('\n');
		if (rendered) {
			log(repairLog, path, 'repairable', 'template blocks -> template text', value, rendered);
			return rendered;
		}
	}
	if (isRecord(value)) {
		if (typeof value.content === 'string') return value.content.trim();
		if (typeof value.template === 'string') return value.template.trim();
	}
	log(repairLog, path, 'downgradable', 'missing template -> fallback template', value, fallback);
	return fallback;
}

function repairLoopConfig(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): void {
	for (const key of ['items', 'rows', 'source', 'dataRef']) {
		if (block.data === undefined && block[key] !== undefined) {
			const before = block[key];
			block.data = rowsRef(before);
			delete block[key];
			log(repairLog, `${path}.${key}`, 'repairable', `${key} -> data rows`, before, block.data);
		}
	}
	if (block.data !== undefined) {
		const before = block.data;
		const after = rowsRef(before);
		if (after !== before) {
			block.data = after;
			log(repairLog, `${path}.data`, 'repairable', 'cell data ref -> rows ref', before, after);
		}
	}
	const template = firstDefined(block, ['template', 'body', 'content', 'children', 'blocks']);
	block.template = templateFromUnknown(
		template,
		block.type === 'group' ? '$key' : '$item',
		`${path}.template`,
		repairLog
	);
	if (block.type === 'group') {
		moveAlias(block, 'groupBy', 'by', path, repairLog, 'groupBy -> by');
		moveAlias(block, 'column', 'by', path, repairLog, 'column -> by');
		moveAlias(block, 'field', 'by', path, repairLog, 'field -> by');
		const order = stringList(block.order);
		if (order && !sameStringArray(block.order, order)) {
			const before = block.order;
			block.order = order;
			log(repairLog, `${path}.order`, 'repairable', 'order -> string array', before, order);
		}
		if (!block.by) {
			log(repairLog, `${path}.by`, 'askable', 'group missing by column');
		}
	}
	if (!block.data) {
		log(repairLog, `${path}.data`, 'askable', `${block.type} missing data source`);
	}
}

function parseConditionString(value: string): Record<string, unknown> | null {
	const trimmed = value.trim();
	const match = trimmed.match(/^([A-Za-z_]\w*)\((.*),(.*)\)$/);
	if (!match) return null;
	const opAlias = match[1] === 'eq' ? 'equals' : match[1];
	return {
		op: opAlias,
		left: match[2].trim(),
		right: match[3].trim()
	};
}

function normalizeConditionTest(block: Record<string, unknown>): Record<string, unknown> | null {
	if (isRecord(block.test)) return block.test;
	if (isRecord(block.condition)) return block.condition;
	const condition = firstDefined(block, ['condition', 'when', 'expr', 'expression', 'predicate']);
	if (typeof condition === 'string') return parseConditionString(condition);
	const op = firstDefined(block, ['op', 'operator']);
	const left = firstDefined(block, ['left', 'lhs', 'value', 'ref']);
	const right = firstDefined(block, ['right', 'rhs', 'threshold', 'equals']);
	if (typeof op === 'string' && left !== undefined && right !== undefined)
		return { op, left, right };
	return null;
}

function repairConditionalConfig(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): NotebookBlueprintBlock[] | null {
	const beforeType = block.type;
	block.type = 'conditional';
	if (beforeType !== 'conditional') {
		log(
			repairLog,
			`${path}.type`,
			'repairable',
			'conditional alias -> conditional',
			beforeType,
			'conditional'
		);
	}
	const test = normalizeConditionTest(block);
	const thenSource = firstDefined(block, ['then', 'blocks', 'children', 'body', 'content']);
	const elseSource = firstDefined(block, ['else', 'otherwise', 'fallback', 'elseBlocks']);
	const thenBlocks = blocksFromUnknown(thenSource, `${path}.then`, repairLog);
	if (!test) {
		log(
			repairLog,
			`${path}.test`,
			'downgradable',
			'malformed conditional -> unconditional content'
		);
		return thenBlocks;
	}
	block.test = test;
	block.then = thenBlocks;
	block.else = blocksFromUnknown(elseSource, `${path}.else`, repairLog);
	return null;
}

function normalizeTabs(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): void {
	const rawTabs = firstDefined(block, ['tabs', 'items', 'children', 'sections', 'panes']);
	if (!Array.isArray(rawTabs)) {
		if (rawTabs !== undefined)
			log(repairLog, `${path}.tabs`, 'repairable', 'non-array tabs -> empty tabs');
		block.tabs = [];
		return;
	}
	const tabs = rawTabs.map((tab, index) => {
		if (!isRecord(tab)) {
			return {
				label: `Tab ${index + 1}`,
				blocks: blocksFromUnknown(tab, `${path}.tabs.${index}.blocks`, repairLog)
			};
		}
		const label =
			typeof firstDefined(tab, ['label', 'title', 'name', 'summary']) === 'string'
				? (firstDefined(tab, ['label', 'title', 'name', 'summary']) as string)
				: `Tab ${index + 1}`;
		return {
			...tab,
			label,
			blocks: blocksFromUnknown(
				firstDefined(tab, ['blocks', 'children', 'body', 'content']),
				`${path}.tabs.${index}.blocks`,
				repairLog
			)
		};
	});
	block.tabs = tabs;
	if (!tabs.length) {
		block.tabs = [{ label: 'Overview', blocks: [] }];
		log(repairLog, `${path}.tabs`, 'downgradable', 'empty tabs -> placeholder tab');
	}
}

function normalizeColumns(
	block: Record<string, unknown>,
	path: string,
	repairLog: RepairLogEntry[]
): void {
	const rawColumns = firstDefined(block, ['columns', 'cols', 'items', 'children']);
	if (!Array.isArray(rawColumns)) {
		if (rawColumns !== undefined)
			log(repairLog, `${path}.columns`, 'repairable', 'non-array columns -> single column');
		block.columns = [
			{
				blocks: blocksFromUnknown(
					firstDefined(block, ['blocks', 'body', 'content']),
					`${path}.columns.0.blocks`,
					repairLog
				)
			}
		];
		return;
	}
	block.columns = rawColumns.map((column, index) => {
		if (!isRecord(column)) {
			return {
				blocks: blocksFromUnknown(column, `${path}.columns.${index}.blocks`, repairLog)
			};
		}
		return {
			...column,
			blocks: blocksFromUnknown(
				firstDefined(column, ['blocks', 'children', 'body', 'content']),
				`${path}.columns.${index}.blocks`,
				repairLog
			)
		};
	});
}

function repairBlocks(
	value: unknown,
	path: string,
	repairLog: RepairLogEntry[]
): NotebookBlueprintBlock[] {
	if (!Array.isArray(value)) {
		if (value !== undefined) {
			log(repairLog, path, 'repairable', 'non-array block list -> empty list', value, []);
		}
		return [];
	}
	return value.flatMap((item, index) => repairBlock(item, `${path}.${index}`, repairLog));
}

function repairBlock(
	value: unknown,
	path: string,
	repairLog: RepairLogEntry[]
): NotebookBlueprintBlock[] {
	if (!isRecord(value)) {
		log(repairLog, path, 'downgradable', 'non-object block -> removed', value, undefined);
		return [];
	}
	let block: Record<string, unknown> = { ...value };
	if (block.type === 'markdown') {
		block.type = 'text';
		log(repairLog, `${path}.type`, 'repairable', 'markdown alias -> text', 'markdown', 'text');
	}
	if (block.type === 'markdocWidget' && isRecord(block.attrs)) {
		const attrs = block.attrs as Record<string, unknown>;
		const tagName = attrs.tagName;
		if (typeof tagName === 'string') {
			let parsed: Record<string, unknown> = {};
			if (typeof attrs.attrsJson === 'string') {
				try {
					const candidate = JSON.parse(attrs.attrsJson);
					if (isRecord(candidate)) parsed = candidate;
				} catch {
					parsed = {};
				}
			}
			if (tagName === 'chart' && typeof parsed.type === 'string') {
				parsed.chartType = parsed.chartType ?? parsed.type;
			}
			if (tagName === 'callout' && typeof parsed.type === 'string') {
				parsed.variant = parsed.variant ?? parsed.type;
			}
			block = { ...parsed, type: tagName };
			log(repairLog, path, 'repairable', 'raw markdocWidget -> blueprint block', value, block);
		}
	}
	if (typeof block.type === 'string' && LOGIC_BLOCK_TYPE_ALIASES.has(block.type)) {
		const before = block.type;
		block.type = LOGIC_BLOCK_TYPE_ALIASES.get(block.type);
		log(
			repairLog,
			`${path}.type`,
			'repairable',
			'component type alias -> canonical type',
			before,
			block.type
		);
	}
	if (block.type === 'dashboard' || block.type === 'section') {
		log(
			repairLog,
			`${path}.type`,
			'repairable',
			'wrapper block -> spliced child blocks',
			block.type
		);
		return repairBlocks(block.blocks, `${path}.blocks`, repairLog);
	}
	block = repairChartLikeBlock(block, path, repairLog);
	if (block.type === 'conditional') {
		const replacement = repairConditionalConfig(block, path, repairLog);
		if (replacement) return replacement;
	}

	if (['metric', 'card', 'callout'].includes(String(block.type)))
		repairIcon(block, path, repairLog);
	if (block.type === 'metric') {
		const iconCount = Number(block.iconCount);
		const iconTotal = Number(block.iconTotal);
		if (
			block.iconCount !== undefined &&
			(!block.icon ||
				!Number.isInteger(iconCount) ||
				iconCount < 1 ||
				iconCount > PICTOGRAM_MAX_ICONS ||
				(block.iconTotal !== undefined &&
					(!Number.isInteger(iconTotal) ||
						iconTotal < iconCount ||
						iconTotal > PICTOGRAM_MAX_ICONS)))
		) {
			const before = { iconCount: block.iconCount, iconTotal: block.iconTotal };
			delete block.iconCount;
			delete block.iconTotal;
			log(repairLog, path, 'downgradable', 'oversized/invalid pictogram -> plain metric', before);
		}
	}
	if (block.type === 'chart') {
		repairChartConfig(block, path, repairLog);
		const chartType = block.chartType;
		if (typeof chartType === 'string' && !CHART_TYPES.has(chartType)) {
			const fallback = block.x && (block.y || block.yColumns) ? 'bar' : 'table';
			block.chartType = fallback;
			log(
				repairLog,
				`${path}.chartType`,
				'downgradable',
				'invalid chart type -> fallback',
				chartType,
				fallback
			);
		}
		if (!block.x && !block.y && !block.yColumns && !block.ref && !block.data) {
			block.chartType = 'table';
			log(repairLog, path, 'downgradable', 'missing chart data/axes -> table view');
		}
	}
	if (block.type === 'datatable') {
		repairDatatableConfig(block, path, repairLog);
	}
	if (block.type === 'badge') {
		moveAlias(block, 'status', 'value', path, repairLog, 'status -> value');
		moveAlias(block, 'label', 'value', path, repairLog, 'label -> value');
		repairEnumValue(block, 'color', TONE_VALUES, 'neutral', path, repairLog);
	}
	if (block.type === 'progress') {
		moveAlias(block, 'total', 'max', path, repairLog, 'total -> max');
		moveAlias(block, 'current', 'value', path, repairLog, 'current -> value');
		repairEnumValue(block, 'color', TONE_VALUES, 'info', path, repairLog);
	}
	if (block.type === 'filter') {
		moveAlias(block, 'name', 'param', path, repairLog, 'name -> param');
		moveAlias(block, 'parameter', 'param', path, repairLog, 'parameter -> param');
		moveAlias(block, 'controlType', 'kind', path, repairLog, 'controlType -> kind');
		moveAlias(block, 'filterType', 'kind', path, repairLog, 'filterType -> kind');
		const options = stringList(block.options);
		if (options && !sameStringArray(block.options, options)) {
			const before = block.options;
			block.options = options;
			log(repairLog, `${path}.options`, 'repairable', 'options -> string array', before, options);
		}
		const kind = block.kind;
		if (typeof kind === 'string' && kind === 'multi') {
			block.kind = 'multi-select';
			log(
				repairLog,
				`${path}.kind`,
				'repairable',
				'legacy multi filter -> multi-select',
				kind,
				block.kind
			);
		} else if (typeof kind === 'string' && !FILTER_KINDS.has(kind)) {
			block.kind = 'dropdown';
			log(
				repairLog,
				`${path}.kind`,
				'repairable',
				'invalid filter kind -> dropdown',
				kind,
				block.kind
			);
		}
		if (
			!block.param &&
			!block.startParam &&
			!block.endParam &&
			!block.minParam &&
			!block.maxParam
		) {
			log(repairLog, path, 'downgradable', 'unwired filter -> removed', block);
			return [];
		}
	}
	if (block.type === 'grid') {
		if (block.items === undefined) {
			const source = firstDefined(block, ['blocks', 'children', 'content']);
			if (source !== undefined) {
				block.items = source;
				log(repairLog, `${path}.items`, 'repairable', 'grid child alias -> items');
			}
		}
		const cols = Number(block.cols ?? 3);
		if (!Number.isInteger(cols) || cols < 1 || cols > 4) {
			const nextCols = Math.min(4, Math.max(1, Number.isInteger(cols) ? cols : 3));
			log(repairLog, `${path}.cols`, 'repairable', 'grid cols -> 1-4 range', block.cols, nextCols);
			block.cols = nextCols;
		}
		const gridCols = Number(block.cols ?? 3);
		const repairedItems = repairBlocks(block.items, `${path}.items`, repairLog);
		const compactItems: NotebookBlueprintBlock[] = [];
		const spillover: NotebookBlueprintBlock[] = [];
		for (const item of repairedItems) {
			const itemRecord = item as Record<string, unknown>;
			if (['chart', 'datatable', 'mermaid', 'columns', 'tabs'].includes(String(itemRecord.type))) {
				spillover.push(item);
				log(repairLog, path, 'repairable', 'large grid item -> sibling block', itemRecord.type);
				continue;
			}
			const span = Number(itemRecord.span);
			if (Number.isInteger(span) && span > gridCols) {
				itemRecord.span = gridCols;
				log(
					repairLog,
					`${path}.items.span`,
					'repairable',
					'grid item span -> cols',
					span,
					gridCols
				);
			}
			compactItems.push(item);
		}
		const cap = gridCols === 1 ? 8 : gridCols * 3;
		if (compactItems.length > cap) {
			const first = compactItems.slice(0, cap);
			const rest = compactItems.slice(cap);
			block.items = first;
			log(
				repairLog,
				`${path}.items`,
				'repairable',
				'overloaded grid -> split section',
				compactItems.length,
				cap
			);
			return [
				block as NotebookBlueprintBlock,
				{ ...block, items: rest } as NotebookBlueprintBlock,
				...spillover
			];
		}
		block.items = compactItems;
		return [block as NotebookBlueprintBlock, ...spillover];
	}
	if (block.type === 'columns') {
		normalizeColumns(block, path, repairLog);
	}
	if (['card', 'callout', 'details'].includes(String(block.type))) {
		if (block.type === 'callout') {
			moveAlias(block, 'severity', 'variant', path, repairLog, 'severity -> variant');
			moveAlias(block, 'tone', 'variant', path, repairLog, 'tone -> variant');
			repairEnumValue(block, 'variant', TONE_VALUES, 'info', path, repairLog);
		}
		if (block.type === 'card') {
			repairEnumValue(block, 'accent', TONE_VALUES, 'neutral', path, repairLog);
		}
		if (block.type === 'details') {
			moveAlias(block, 'label', 'summary', path, repairLog, 'label -> summary');
			moveAlias(block, 'title', 'summary', path, repairLog, 'title -> summary');
			if (!block.summary) {
				block.summary = 'Details';
				log(repairLog, `${path}.summary`, 'repairable', 'missing summary -> default summary');
			}
		}
		normalizeChildBlocks(block, path, repairLog);
	}
	if (block.type === 'tabs') {
		normalizeTabs(block, path, repairLog);
	}
	if (block.type === 'each' || block.type === 'group') {
		repairLoopConfig(block, path, repairLog);
	}
	if (block.type === 'conditional') {
		block.then = repairBlocks(block.then, `${path}.then`, repairLog);
		block.else = repairBlocks(block.else, `${path}.else`, repairLog);
	}
	if (block.type === 'math') {
		moveAlias(block, 'formula', 'latex', path, repairLog, 'formula -> latex');
		moveAlias(block, 'expression', 'latex', path, repairLog, 'expression -> latex');
	}
	if (block.type === 'embed' || block.type === 'bookmark') {
		moveAlias(block, 'href', 'url', path, repairLog, 'href -> url');
		moveAlias(block, 'src', 'url', path, repairLog, 'src -> url');
	}
	if (block.type === 'video') {
		moveAlias(block, 'url', 'src', path, repairLog, 'url -> src');
	}
	if (block.type === 'mermaid') {
		moveAlias(block, 'diagram', 'code', path, repairLog, 'diagram -> code');
		moveAlias(block, 'source', 'codeRef', path, repairLog, 'source -> codeRef');
	}
	return [block as NotebookBlueprintBlock];
}

export function repairNotebookBlueprint(
	blueprint: NotebookBlueprint,
	options: { autoRepair?: 'off' | 'safe' | 'aggressive'; knownRefs?: Iterable<string> } = {}
): RepairNotebookBlueprintResult {
	if (options.autoRepair === 'off') {
		const compiled = compileNotebookBlueprint(blueprint, options.knownRefs);
		return {
			blueprint,
			repairLog: [],
			diagnostics: [...compiled.diagnostics, ...fatalReportingRefDiagnostics(blueprint.blocks)]
		};
	}
	const repairLog: RepairLogEntry[] = [];
	const repaired: NotebookBlueprint = {
		...blueprint,
		blocks: repairBlocks(blueprint.blocks, 'blocks', repairLog)
	};
	const compiled = compileNotebookBlueprint(repaired, options.knownRefs);
	return {
		blueprint: repaired,
		repairLog,
		diagnostics: [...compiled.diagnostics, ...fatalReportingRefDiagnostics(repaired.blocks)]
	};
}

function fatalReportingRefDiagnostics(
	blocks: NotebookBlueprintBlock[],
	path = 'blocks'
): NotebookBlueprintDiagnostic[] {
	const diagnostics: NotebookBlueprintDiagnostic[] = [];
	const presentationTypes = new Set([
		'metric',
		'chart',
		'datatable',
		'badge',
		'progress',
		'filter',
		'card',
		'callout'
	]);
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index] as Record<string, unknown>;
		const blockPath = `${path}.${index}`;
		if (presentationTypes.has(String(block.type))) {
			const serialized = JSON.stringify(block);
			const match = serialized.match(/\$stg_[A-Za-z_]\w*/);
			if (match) {
				diagnostics.push({
					path: blockPath,
					message: `Unsafe reporting reference "${match[0]}". Use a dim_, fct_, mart_, metric_, or explicitly documented alternative for user-facing data app views.`
				});
			}
		}
		if (Array.isArray(block.items)) {
			diagnostics.push(
				...fatalReportingRefDiagnostics(
					block.items as NotebookBlueprintBlock[],
					`${blockPath}.items`
				)
			);
		}
		if (Array.isArray(block.blocks)) {
			diagnostics.push(
				...fatalReportingRefDiagnostics(
					block.blocks as NotebookBlueprintBlock[],
					`${blockPath}.blocks`
				)
			);
		}
		if (Array.isArray(block.columns)) {
			block.columns.forEach((column, columnIndex) => {
				if (
					column &&
					typeof column === 'object' &&
					Array.isArray((column as { blocks?: unknown }).blocks)
				) {
					diagnostics.push(
						...fatalReportingRefDiagnostics(
							(column as { blocks: NotebookBlueprintBlock[] }).blocks,
							`${blockPath}.columns.${columnIndex}.blocks`
						)
					);
				}
			});
		}
		if (Array.isArray(block.tabs)) {
			block.tabs.forEach((tab, tabIndex) => {
				if (tab && typeof tab === 'object' && Array.isArray((tab as { blocks?: unknown }).blocks)) {
					diagnostics.push(
						...fatalReportingRefDiagnostics(
							(tab as { blocks: NotebookBlueprintBlock[] }).blocks,
							`${blockPath}.tabs.${tabIndex}.blocks`
						)
					);
				}
			});
		}
	}
	return diagnostics;
}

function countBlocks(
	blocks: NotebookBlueprintBlock[],
	counts = new Map<string, number>()
): Map<string, number> {
	for (const block of blocks) {
		const record = block as Record<string, unknown>;
		const type = String(record.type ?? 'unknown');
		counts.set(type, (counts.get(type) ?? 0) + 1);
		if (Array.isArray(record.items)) countBlocks(record.items as NotebookBlueprintBlock[], counts);
		if (Array.isArray(record.blocks))
			countBlocks(record.blocks as NotebookBlueprintBlock[], counts);
		if (Array.isArray(record.columns)) {
			for (const column of record.columns) {
				if (isRecord(column) && Array.isArray(column.blocks)) {
					countBlocks(column.blocks as NotebookBlueprintBlock[], counts);
				}
			}
		}
		if (Array.isArray(record.tabs)) {
			for (const tab of record.tabs) {
				if (isRecord(tab) && Array.isArray(tab.blocks)) {
					countBlocks(tab.blocks as NotebookBlueprintBlock[], counts);
				}
			}
		}
	}
	return counts;
}

export function scoreNotebookBlueprint(
	blueprint: NotebookBlueprint,
	options: {
		target?: 'valid' | 'polished' | 'publication';
		knownRefs?: Iterable<string>;
		autoRepair?: 'off' | 'safe' | 'aggressive';
	} = {}
): ScoreNotebookBlueprintResult {
	const target = options.target ?? 'polished';
	const repaired = repairNotebookBlueprint(blueprint, options);
	const counts = countBlocks(repaired.blueprint.blocks);
	const breakdown: Record<string, number> = {
		validity: Math.max(0, 30 - repaired.diagnostics.length * 10),
		recovery: Math.min(15, repaired.repairLog.length * 3),
		dataViews: Math.min(20, ((counts.get('chart') ?? 0) + (counts.get('datatable') ?? 0)) * 8),
		interaction: Math.min(
			15,
			((counts.get('filter') ?? 0) + (counts.get('tabs') ?? 0) + (counts.get('details') ?? 0)) * 5
		),
		layout: Math.min(15, ((counts.get('columns') ?? 0) + (counts.get('grid') ?? 0)) * 5),
		narrative: Math.min(10, (counts.get('text') ?? 0) * 3 + (counts.get('callout') ?? 0) * 3)
	};
	const flatKpiPenalty =
		(counts.get('metric') ?? 0) >= 6 && !(counts.get('chart') || counts.get('datatable')) ? 12 : 0;
	const score = Math.max(
		0,
		Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0) - flatKpiPenalty)
	);
	const catalog = getComponentCapabilityCatalog();
	return {
		score,
		target,
		breakdown,
		diagnostics: repaired.diagnostics.map((diagnostic) => ({ ...diagnostic, class: 'fatal' })),
		componentCatalog: { version: catalog.version, hash: catalog.hash }
	};
}

export function getNotebookAppGrammar() {
	const catalog = getComponentCapabilityCatalog();
	return {
		purpose:
			'Compile general data apps into notebook blueprints using self-describing component capabilities.',
		compileTarget: 'notebook',
		mutationTools: ['create_notebook', 'apply_notebook_patch', 'validate_notebook'],
		readOnlyHelpers: [
			'get_component_capabilities',
			'get_notebook_app_grammar',
			'plan_notebook_app',
			'repair_notebook_blueprint',
			'score_notebook_blueprint'
		],
		intentFields: [
			'goal',
			'audience',
			'primaryWorkflow',
			'userMoves',
			'viewNeeds',
			'runtimeContract'
		],
		viewSkeletonPrimitives: [
			'metric',
			'chart',
			'table',
			'form',
			'detail_panel',
			'map',
			'timeline',
			'narrative',
			'chat_panel'
		],
		compositionSampler: {
			kind: 'local_adjacency_sampling',
			description:
				'Lightweight WFC-style local composition sampling over primitive view needs; not a global solver and not an app-type router.',
			adjacency: LOCAL_COMPOSITION_ADJACENCY
		},
		interactionPrimitives: [
			'inspect',
			'filter',
			'compare',
			'edit',
			'simulate',
			'annotate',
			'approve',
			'export',
			'ask'
		],
		failSoftDiagnostics: ['repairable', 'downgradable', 'askable', 'fatal'],
		repairPolicy: [
			'repairable diagnostics do not consume reasoning retry budget',
			'downgradable diagnostics can ship with a simpler component',
			'askable diagnostics need user/schema clarification',
			'fatal diagnostics block mutation'
		],
		componentCatalog: {
			version: catalog.version,
			hash: catalog.hash,
			components: catalog.components.map((component) => ({
				id: component.id,
				kind: component.kind,
				description: component.description,
				props: Object.values(component.propsSchema),
				defaults: component.defaults,
				repairRules: component.repairRules,
				dataRequirements: component.dataRequirements,
				interactionCapabilities: component.interactionCapabilities
			}))
		},
		iconNames: DASHBOARD_ICON_NAMES
	};
}
