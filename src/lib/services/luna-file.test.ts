import { describe, it, expect } from 'vitest';
import { parseLunaFile, serializeLunaFile, type SerializableCell } from './luna-file.js';

function queryCell(overrides: Partial<SerializableCell> = {}): SerializableCell {
	return {
		id: 'stg_orders',
		cellType: 'query',
		markdown: '',
		udfBody: '',
		outputName: 'stg_orders',
		language: 'prql',
		code: 'from orders\nfilter status == "completed"',
		connectionId: null,
		materializeMode: 'table',
		dbtSchema: null,
		dbtTags: [],
		editMode: 'gui',
		resultViewMode: 'table',
		resultChartConfig: null,
		plotMode: 'code',
		plotConfig: null,
		plotSourceCellId: null,
		columnFormatRules: {},
		columnWidths: {},
		guiStages: [{ type: 'from', table: '' }],
		display: 'full',
		hideResult: false,
		hideInReport: false,
		stageResultsCollapsed: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell',
		promotedModelPath: null,
		...overrides
	};
}

function markdownCell(markdown: string): SerializableCell {
	return { ...queryCell(), cellType: 'markdown', markdown, code: '' };
}

function udfCell(udfBody: string): SerializableCell {
	return { ...queryCell(), cellType: 'udf', udfBody, code: '' };
}

function pythonCell(code: string, outputName = 'py_analysis'): SerializableCell {
	return { ...queryCell(), cellType: 'python', code, outputName };
}

describe('parseLunaFile', () => {
	it('parses a single query cell', () => {
		const doc = parseLunaFile(
			['{% query name="x" lang="prql" %}', 'from orders', '{% /query %}'].join('\n')
		);
		expect(doc.entries).toEqual([
			{
				kind: 'query',
				name: 'x',
				lang: 'prql',
				connection: null,
				materialized: 'table',
				schema: null,
				tags: [],
				meta: {},
				code: 'from orders'
			}
		]);
	});

	it('parses interleaved markdown prose and query cells in document order', () => {
		const content = [
			'# Notebook title',
			'',
			'Some findings here.',
			'',
			'{% query name="stg_orders" lang="prql" %}',
			'from orders',
			'{% /query %}',
			'',
			'More prose after.'
		].join('\n');
		const doc = parseLunaFile(content);
		expect(doc.entries.map((e) => e.kind)).toEqual(['markdown', 'query', 'markdown']);
		expect(doc.entries[0]).toMatchObject({
			kind: 'markdown',
			markdown: '# Notebook title\n\nSome findings here.'
		});
		expect(doc.entries[2]).toMatchObject({ kind: 'markdown', markdown: 'More prose after.' });
	});

	it('parses a model ref placeholder', () => {
		const doc = parseLunaFile('{% model ref="stg_customers" /%}');
		expect(doc.entries).toEqual([{ kind: 'modelRef', ref: 'stg_customers' }]);
	});

	it('parses a udf block', () => {
		const doc = parseLunaFile(
			['{% udf %}', 'def my_udf(x: int) -> float:', '    return x * 1.5', '{% /udf %}'].join('\n')
		);
		expect(doc.entries).toEqual([
			{ kind: 'udf', udfBody: 'def my_udf(x: int) -> float:\n    return x * 1.5' }
		]);
	});

	it('parses a python block with name and multiline code', () => {
		const doc = parseLunaFile(
			[
				'{% python name="py_analysis" %}',
				'import pandas as pd',
				'print("hello")',
				'orders.head()',
				'{% /python %}'
			].join('\n')
		);
		expect(doc.entries).toEqual([
			{
				kind: 'python',
				name: 'py_analysis',
				code: 'import pandas as pd\nprint("hello")\norders.head()'
			}
		]);
	});

	it('parses query attributes: connection, materialized, schema, tags', () => {
		const doc = parseLunaFile(
			[
				'{% query name="x" lang="sql" connection="pg.main" materialized="view" schema="analytics" tags="pii,nightly" %}',
				'select 1',
				'{% /query %}'
			].join('\n')
		);
		expect(doc.entries[0]).toMatchObject({
			kind: 'query',
			lang: 'sql',
			connection: 'pg.main',
			materialized: 'view',
			schema: 'analytics',
			tags: ['pii', 'nightly']
		});
	});

	it('does not corrupt parsing when a query body contains a literal {% in a comment or string (regression)', () => {
		const content = [
			'{% query name="x" lang="sql" %}',
			"-- a comment with {% weird %} chars and {{ ref('y') }}",
			"select 'literal {% not a tag %}' as col",
			'{% /query %}',
			'',
			'Trailing prose.'
		].join('\n');
		const doc = parseLunaFile(content);
		expect(doc.entries).toHaveLength(2);
		expect(doc.entries[0].kind).toBe('query');
		const query = doc.entries[0] as { kind: 'query'; code: string };
		expect(query.code).toContain("-- a comment with {% weird %} chars and {{ ref('y') }}");
		expect(query.code).toContain("select 'literal {% not a tag %}' as col");
		expect(doc.entries[1]).toMatchObject({ kind: 'markdown', markdown: 'Trailing prose.' });
	});
});

describe('serializeLunaFile', () => {
	it('round-trips a query cell', () => {
		const content = serializeLunaFile([queryCell()]);
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([
			{
				kind: 'query',
				name: 'stg_orders',
				lang: 'prql',
				connection: null,
				materialized: 'table',
				schema: null,
				tags: [],
				meta: {},
				code: 'from orders\nfilter status == "completed"'
			}
		]);
	});

	it('round-trips markdown + query cells preserving order', () => {
		const content = serializeLunaFile([markdownCell('# Title\n\nSome prose.'), queryCell()]);
		const doc = parseLunaFile(content);
		expect(doc.entries.map((e) => e.kind)).toEqual(['markdown', 'query']);
	});

	it('round-trips two adjacent markdown cells without merging them (regression)', () => {
		const content = serializeLunaFile([markdownCell('First cell'), markdownCell('Second cell')]);
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([
			{ kind: 'markdown', markdown: 'First cell' },
			{ kind: 'markdown', markdown: 'Second cell' }
		]);
	});

	it('round-trips an emptied markdown cell instead of losing it (regression)', () => {
		const content = serializeLunaFile([markdownCell('Some content'), markdownCell('')]);
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([
			{ kind: 'markdown', markdown: 'Some content' },
			{ kind: 'markdown', markdown: '' }
		]);
	});

	it('round-trips a udf cell', () => {
		const body = 'def my_udf(x: int) -> float:\n    return x * 1.5';
		const content = serializeLunaFile([udfCell(body)]);
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([{ kind: 'udf', udfBody: body }]);
	});

	it('round-trips a python cell preserving name and code', () => {
		const code = 'print("hi")\norders.groupby("status").size()';
		const content = serializeLunaFile([pythonCell(code, 'py_analysis')]);
		expect(content).toContain('{% python name="py_analysis" %}');
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([{ kind: 'python', name: 'py_analysis', code }]);
	});

	it('round-trips markdown + python + query cells in document order', () => {
		const content = serializeLunaFile([
			markdownCell('# Analysis'),
			pythonCell('orders.describe()', 'summary_stats'),
			queryCell({ outputName: 'stg_orders' })
		]);
		const doc = parseLunaFile(content);
		expect(doc.entries.map((e) => e.kind)).toEqual(['markdown', 'python', 'query']);
	});

	it('serializes a promoted cell as a model ref placeholder', () => {
		const content = serializeLunaFile([
			queryCell({ promotedModelPath: 'models/staging/stg_orders.prql' })
		]);
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([{ kind: 'modelRef', ref: 'stg_orders' }]);
	});

	it('round-trips non-default metadata (guiStages, display, materialize mode)', () => {
		const cell = queryCell({
			materializeMode: 'view',
			dbtSchema: 'analytics',
			dbtTags: ['pii'],
			display: 'collapsed',
			guiStages: [
				{ type: 'from', table: 'orders' },
				{
					type: 'filter',
					conditions: [{ column: 'status', op: '==', value: 'completed' }],
					logic: 'and'
				}
			]
		});
		const content = serializeLunaFile([cell]);
		const doc = parseLunaFile(content);
		const query = doc.entries[0] as {
			kind: 'query';
			materialized: string;
			schema: string | null;
			tags: string[];
			meta: { display?: string; guiStages?: unknown[] };
		};
		expect(query.materialized).toBe('view');
		expect(query.schema).toBe('analytics');
		expect(query.tags).toEqual(['pii']);
		expect(query.meta.display).toBe('collapsed');
		expect(query.meta.guiStages).toHaveLength(2);
	});

	it('round-trips a query body containing a literal {% sequence (regression)', () => {
		const cell = queryCell({
			language: 'sql',
			code: "-- weird {% chars %} here\nselect '{{ ref(\\'x\\') }}' as col"
		});
		const content = serializeLunaFile([cell]);
		const doc = parseLunaFile(content);
		const query = doc.entries[0] as { kind: 'query'; code: string };
		expect(query.code).toBe(cell.code);
	});

	it('leaves visual (default) markdown cells unmarked for backward compatibility', () => {
		const content = serializeLunaFile([{ ...markdownCell('# Hi'), markdownEditMode: 'visual' }]);
		expect(content).not.toContain('lunapad:md');
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([{ kind: 'markdown', markdown: '# Hi' }]);
	});

	it('persists and round-trips a source-mode markdown cell', () => {
		const content = serializeLunaFile([{ ...markdownCell('# Hi'), markdownEditMode: 'source' }]);
		expect(content).toContain('<!--lunapad:md source-->');
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([{ kind: 'markdown', markdown: '# Hi', editMode: 'source' }]);
	});

	it('unmarked prose parses as visual (implicit default)', () => {
		const doc = parseLunaFile('# Just prose\n\nNo marker here.');
		expect(doc.entries).toEqual([
			{ kind: 'markdown', markdown: '# Just prose\n\nNo marker here.' }
		]);
	});

	it('round-trips mixed markdown modes across adjacent cells', () => {
		const content = serializeLunaFile([
			{ ...markdownCell('First'), markdownEditMode: 'source' },
			{ ...markdownCell('Second'), markdownEditMode: 'visual' }
		]);
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([
			{ kind: 'markdown', markdown: 'First', editMode: 'source' },
			{ kind: 'markdown', markdown: 'Second' }
		]);
	});

	it('persists source mode on an emptied markdown cell', () => {
		const content = serializeLunaFile([
			{ ...markdownCell('Body'), markdownEditMode: 'visual' },
			{ ...markdownCell(''), markdownEditMode: 'source' }
		]);
		const doc = parseLunaFile(content);
		expect(doc.entries).toEqual([
			{ kind: 'markdown', markdown: 'Body' },
			{ kind: 'markdown', markdown: '', editMode: 'source' }
		]);
	});
});
