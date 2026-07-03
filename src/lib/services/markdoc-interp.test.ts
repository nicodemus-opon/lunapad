import { describe, it, expect } from 'vitest';
import Markdoc, { Tag } from '@markdoc/markdoc';
import {
	buildMarkdocVariables,
	renderMarkdocCell,
	extractMarkdocRefs,
	validateMarkdocMarkdown,
	normalizeMermaidCode
} from './markdoc-interp.js';
import type { Cell } from '$lib/stores/notebook.svelte';

function makeCell(outputName: string, rows: Record<string, unknown>[], columns?: string[]): Cell {
	return {
		id: outputName,
		outputName,
		cellType: 'query',
		result: { rows, columns: columns ?? Object.keys(rows[0] ?? {}), truncated: false }
	} as unknown as Cell;
}

function findTag(nodes: unknown, name: string): Tag | undefined {
	for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
		if (Tag.isTag(node)) {
			if ((node as Tag).name === name) return node as Tag;
			const found = findTag((node as Tag).children, name);
			if (found) return found;
		}
	}
	return undefined;
}

function textOf(nodes: unknown): string {
	if (nodes == null || typeof nodes === 'boolean') return '';
	if (typeof nodes === 'string' || typeof nodes === 'number') return String(nodes);
	if (Array.isArray(nodes)) return nodes.map(textOf).join('');
	if (Tag.isTag(nodes)) return textOf((nodes as Tag).children);
	return '';
}

describe('buildMarkdocVariables', () => {
	it('maps cell results to a variables object', () => {
		const cells = [makeCell('orders', [{ revenue: 42000 }, { revenue: 1 }])];
		const vars = buildMarkdocVariables(cells);
		expect(vars.orders).toMatchObject({ count: 2, rowCount: 2, revenue: 42000 });
	});

	it('skips markdown cells and cells without results', () => {
		const queryNoResult = { ...makeCell('a', []), result: null };
		const markdownCell = {
			id: 'b',
			outputName: 'b',
			cellType: 'markdown',
			result: null
		} as unknown as Cell;
		const vars = buildMarkdocVariables([queryNoResult, markdownCell]);
		expect(vars).toEqual({});
	});

	it('uses totalRowCount when the displayed rows are truncated', () => {
		const cell = makeCell('orders', [{ id: 1 }, { id: 2 }]);
		cell.result = {
			rows: cell.result!.rows,
			columns: cell.result!.columns,
			truncated: true,
			totalRowCount: 2000
		};
		const vars = buildMarkdocVariables([cell]);
		expect(vars.orders).toMatchObject({ count: 2000, rowCount: 2000 });
	});
});

describe('renderMarkdocCell', () => {
	it('resolves a bare variable', () => {
		const cells = [makeCell('orders', [{ revenue: 42000 }])];
		const { tree, errors } = renderMarkdocCell('Rev: {% $orders.revenue %}', cells);
		expect(errors).toEqual([]);
		expect(textOf(tree)).toBe('Rev: 42000');
	});

	it('formats with currency()', () => {
		const cells = [makeCell('orders', [{ revenue: 42000 }])];
		const { tree } = renderMarkdocCell('{% currency($orders.revenue) %}', cells);
		expect(textOf(tree)).toBe('$42,000');
	});

	it('formats with percent() and compact()', () => {
		const cells = [makeCell('orders', [{ pct: 75.25, big: 1500000 }])];
		const { tree: t1 } = renderMarkdocCell('{% percent($orders.pct, 1) %}', cells);
		expect(textOf(t1)).toBe('75.3%');
		const { tree: t2 } = renderMarkdocCell('{% compact($orders.big) %}', cells);
		expect(textOf(t2)).toBe('1.5M');
	});

	it('branches on conditionals using gt()', () => {
		const src = `{% if gt($orders.count, 0) %}\nHas data\n{% else /%}\nNo data\n{% /if %}`;
		const withData = renderMarkdocCell(src, [makeCell('orders', [{ id: 1 }])]);
		expect(textOf(withData.tree)).toBe('Has data');

		const empty = renderMarkdocCell(src, [makeCell('orders', [])]);
		expect(textOf(empty.tree)).toBe('No data');
	});

	it('renders a metric tag with computed trend', () => {
		const cells = [makeCell('orders', [{ revenue: 150 }]), makeCell('prev', [{ revenue: 100 }])];
		const { tree } = renderMarkdocCell(
			'{% metric value=$orders.revenue vs=$prev.revenue label="Revenue" /%}',
			cells
		);
		const metric = findTag(tree, 'metric');
		expect(metric).toBeDefined();
		expect(metric?.attributes.value).toBe(150);
		expect(metric?.attributes.label).toBe('Revenue');
		expect(metric?.attributes.trend).toBe('up');
		expect(metric?.attributes.deltaPct).toBeCloseTo(50);
	});

	it('renders a chart tag, translating short attrs to ChartConfig keys', () => {
		const cells = [makeCell('orders', [{ month: 'Jan', revenue: 100 }])];
		const { tree } = renderMarkdocCell(
			'{% chart type="bar" data=$orders.rows x="month" y="revenue" /%}',
			cells
		);
		const chart = findTag(tree, 'chart');
		expect(chart?.attributes.chartType).toBe('bar');
		expect(chart?.attributes.xColumn).toBe('month');
		expect(chart?.attributes.yColumns).toEqual(['revenue']);
		expect(chart?.attributes.data).toEqual([{ month: 'Jan', revenue: 100 }]);
	});

	it('maps type="sparkline" to a compact line chart', () => {
		const cells = [makeCell('orders', [{ d: 'Jan', v: 1 }])];
		const { tree } = renderMarkdocCell(
			'{% chart type="sparkline" data=$orders.rows x="d" y="v" /%}',
			cells
		);
		const chart = findTag(tree, 'chart');
		expect(chart?.attributes.chartType).toBe('line');
		expect(chart?.attributes.compact).toBe(true);
	});

	it("chart ref inherits a cell's resultChartConfig and rows, with inline attrs overriding", () => {
		const cells = [
			{
				...makeCell('orders', [{ region: 'US', revenue: 100 }]),
				resultChartConfig: {
					chartType: 'bar',
					xColumn: 'region',
					yColumns: ['revenue'],
					colorColumn: null
				}
			} as unknown as Cell
		];
		const { tree } = renderMarkdocCell(
			'{% chart ref=$orders type="pie" colorColumn="region" /%}',
			cells
		);
		const chart = findTag(tree, 'chart');
		expect(chart?.attributes.chartType).toBe('pie');
		expect(chart?.attributes.xColumn).toBe('region');
		expect(chart?.attributes.yColumns).toEqual(['revenue']);
		expect(chart?.attributes.colorColumn).toBe('region');
		expect(chart?.attributes.data).toEqual([{ region: 'US', revenue: 100 }]);
	});

	it('renders columns/column/grid/callout/card containers', () => {
		const src = `{% columns %}
{% column %}
left
{% /column %}
{% column %}
right
{% /column %}
{% /columns %}

{% grid cols=2 %}
{% callout type="warning" %}
careful
{% /callout %}
{% /grid %}

{% card title="Data Quality" %}
ok
{% /card %}`;
		const { tree, errors } = renderMarkdocCell(src, []);
		expect(errors).toEqual([]);
		const columns = findTag(tree, 'columns');
		expect(columns).toBeDefined();
		expect(findTag(columns, 'column')).toBeDefined();
		const grid = findTag(tree, 'grid');
		expect(grid?.attributes.cols).toBe(2);
		expect(findTag(grid, 'callout')?.attributes.type).toBe('warning');
		const card = findTag(tree, 'card');
		expect(card?.attributes.title).toBe('Data Quality');
	});

	it('renders a datatable tag passthrough', () => {
		const cells = [
			makeCell('orders', [
				{ month: 'Jan', revenue: 100 },
				{ month: 'Feb', revenue: 200 }
			])
		];
		const { tree } = renderMarkdocCell(
			'{% datatable data=$orders.rows cols=["month","revenue"] limit=1 /%}',
			cells
		);
		const dt = findTag(tree, 'datatable');
		expect(dt?.attributes.cols).toEqual(['month', 'revenue']);
		expect(dt?.attributes.limit).toBe(1);
		expect(dt?.attributes.data).toHaveLength(2);
	});

	it('renders a filter tag passthrough', () => {
		const { tree, errors } = renderMarkdocCell(
			'{% filter kind="dropdown" param="region" label="Region" options=["US","EU"] default="US" /%}',
			[]
		);
		expect(errors).toEqual([]);
		const filter = findTag(tree, 'filter');
		expect(filter?.attributes.kind).toBe('dropdown');
		expect(filter?.attributes.param).toBe('region');
		expect(filter?.attributes.label).toBe('Region');
		expect(filter?.attributes.options).toEqual(['US', 'EU']);
		expect(filter?.attributes.defaultValue).toBe('US');
	});

	it('resolves filter options from a cell variable plus optionsColumn', () => {
		const cells = [makeCell('regions', [{ name: 'US' }, { name: 'EU' }])];
		const { tree } = renderMarkdocCell(
			'{% filter param="region" options=$regions.rows optionsColumn="name" /%}',
			cells
		);
		const filter = findTag(tree, 'filter');
		expect(filter?.attributes.options).toEqual([{ name: 'US' }, { name: 'EU' }]);
		expect(filter?.attributes.optionsColumn).toBe('name');
	});

	it('supports built-in partials', () => {
		const cells = [makeCell('orders', [{ revenue: 42000 }])];
		const config = {
			variables: buildMarkdocVariables(cells),
			partials: { kpi: Markdoc.parse('### {% $label %}') }
		};
		const ast = Markdoc.parse('{% partial file="kpi" variables={label: "Q2"} /%}');
		const out = Markdoc.transform(ast, config);
		expect(textOf(out)).toBe('Q2');
	});

	it('renders a badge tag passthrough', () => {
		const { tree, errors } = renderMarkdocCell('{% badge value="delinquent" color="error" /%}', []);
		expect(errors).toEqual([]);
		const badge = findTag(tree, 'badge');
		expect(badge?.attributes.value).toBe('delinquent');
		expect(badge?.attributes.color).toBe('error');
	});

	it('renders a progress tag passthrough with default max/color', () => {
		const { tree } = renderMarkdocCell('{% progress value=42 label="Done" /%}', []);
		const progress = findTag(tree, 'progress');
		expect(progress?.attributes.value).toBe(42);
		expect(progress?.attributes.max).toBe(100);
		expect(progress?.attributes.color).toBe('info');
	});

	it('renders a details tag with its summary/open and children', () => {
		const { tree } = renderMarkdocCell(
			'{% details summary="More" open=true %}\nhidden text\n{% /details %}',
			[]
		);
		const details = findTag(tree, 'details');
		expect(details?.attributes.summary).toBe('More');
		expect(details?.attributes.open).toBe(true);
		expect(textOf(details)).toContain('hidden text');
	});

	it('renders tabs/tab containers with labels', () => {
		const src = `{% tabs %}
{% tab label="One" %}
first
{% /tab %}
{% tab label="Two" %}
second
{% /tab %}
{% /tabs %}`;
		const { tree, errors } = renderMarkdocCell(src, []);
		expect(errors).toEqual([]);
		const tabs = findTag(tree, 'tabs');
		expect(tabs?.children).toHaveLength(2);
		const firstTab = tabs?.children[0] as Tag;
		expect(firstTab.attributes.label).toBe('One');
		expect(textOf(firstTab)).toContain('first');
	});

	it('surfaces validation errors for unknown tags', () => {
		const { errors } = renderMarkdocCell('{% bogus foo="bar" /%}', []);
		expect(errors.length).toBeGreaterThan(0);
	});

	it('validateMarkdocMarkdown returns positioned errors for unknown tags', () => {
		const diags = validateMarkdocMarkdown('{% bogus foo="bar" /%}', []);
		expect(diags.length).toBeGreaterThan(0);
		expect(diags[0].line).toBeGreaterThanOrEqual(1);
		expect(diags[0].message).toMatch(/bogus/i);
	});

	it('validateMarkdocMarkdown flags undefined $cell refs', () => {
		const diags = validateMarkdocMarkdown('Total: $missing.count', []);
		expect(diags.some((d) => d.message.includes('missing'))).toBe(true);
		expect(diags.find((d) => d.message.includes('missing'))?.line).toBe(1);
	});

	it('preserves static mermaid source with frontmatter, newlines, and [*]', () => {
		const src = `{% mermaid %}
---
title: Simple sample
---
stateDiagram-v2
    [*] --> Still
    Still --> [*]
{% /mermaid %}`;
		const { tree, errors } = renderMarkdocCell(src, []);
		expect(errors).toEqual([]);
		const mermaid = findTag(tree, 'mermaid');
		const code = mermaid?.attributes.code as string;
		expect(code).toContain('---');
		expect(code).toContain('title: Simple sample');
		expect(code).toContain('stateDiagram-v2');
		expect(code).toContain('[*]');
		expect(code).toContain('\n');
		expect(code).not.toContain('[]');
	});

	it('preserves a simple static flowchart mermaid block', () => {
		const src = `{% mermaid %}
graph TD
  A --> B
{% /mermaid %}`;
		const { tree } = renderMarkdocCell(src, []);
		const code = findTag(tree, 'mermaid')?.attributes.code as string;
		expect(code).toBe('graph TD\n  A --> B');
	});

	it('preserves static sequenceDiagram participants on separate lines', () => {
		const src = `{% mermaid %}
sequenceDiagram
  Alice->>Bob: Hello
{% /mermaid %}`;
		const { tree } = renderMarkdocCell(src, []);
		const code = findTag(tree, 'mermaid')?.attributes.code as string;
		expect(code).toContain('sequenceDiagram\n');
		expect(code).toContain('Alice->>Bob: Hello');
	});

	it('expands dynamic kanban mermaid from group/each loops', () => {
		const tasks = [
			{
				id: 1,
				title: 'Design login page',
				status: 'Todo',
				assignee: 'Alice',
				ticket: 'T-001',
				priority: 'High'
			},
			{
				id: 2,
				title: 'Fix auth bug',
				status: 'In Progress',
				assignee: 'Bob',
				ticket: 'T-002',
				priority: 'Very High'
			},
			{
				id: 3,
				title: 'Write API docs',
				status: 'Todo',
				assignee: 'Carol',
				ticket: 'T-003',
				priority: 'Low'
			},
			{
				id: 4,
				title: 'Code review PR #42',
				status: 'Review',
				assignee: 'Alice',
				ticket: 'T-004',
				priority: 'High'
			},
			{
				id: 5,
				title: 'Deploy to staging',
				status: 'In Progress',
				assignee: 'Bob',
				ticket: 'T-005',
				priority: 'High'
			},
			{
				id: 6,
				title: 'Update README',
				status: 'Done',
				assignee: 'Carol',
				ticket: 'T-006',
				priority: 'Very Low'
			},
			{
				id: 7,
				title: 'Add unit tests',
				status: 'Review',
				assignee: 'David',
				ticket: 'T-007',
				priority: 'High'
			},
			{
				id: 8,
				title: 'Fix chart tooltip',
				status: 'Done',
				assignee: 'Alice',
				ticket: 'T-008',
				priority: 'Low'
			}
		];
		const cells = [makeCell('tasks', tasks)];
		const src = `{% mermaid %}
kanban
  {% group data=$tasks.rows by="status" order=["Todo","In Progress","Review","Done"] %}
  $keyId[$key]
    {% each data=$items %}
    t$id[$title]@{ ticket: $ticket, priority: '$priority', assigned: '$assignee' }
    {% /each %}
  {% /group %}
{% /mermaid %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const code = findTag(tree, 'mermaid')?.attributes.code as string;
		expect(code.startsWith('kanban\n')).toBe(true);
		expect(code).toContain('  todo[Todo]');
		expect(code).toContain('  in_progress[In Progress]');
		expect(code).toContain('t1[Design login page]@{ ticket: T-001');
		expect(code).toContain('ticket: T-001');
		expect(code.indexOf('todo[Todo]')).toBeLessThan(code.indexOf('in_progress[In Progress]'));
		expect(code.indexOf('in_progress[In Progress]')).toBeLessThan(code.indexOf('review[Review]'));
	});

	it('preserves template whitespace in expanded mermaid output', () => {
		const tasks = [
			{
				id: 1,
				title: 'Design login page',
				status: 'Todo',
				ticket: 'T-001',
				priority: 'High',
				assignee: 'Alice'
			}
		];
		const cells = [makeCell('tasks', tasks)];
		const src = `{% mermaid %}
kanban
  {% group data=$tasks.rows by="status" %}
  $keyId[$key]
    {% each data=$items %}
    t$id[$title]@{ ticket: $ticket, priority: '$priority', assigned: '$assignee' }
    {% /each %}
  {% /group %}
{% /mermaid %}`;
		const code = findTag(renderMarkdocCell(src, cells).tree, 'mermaid')?.attributes.code as string;
		expect(code).toContain('    t1[Design login page]@{ ticket: T-001');
	});

	it('expands dynamic flowchart nodes via each loop', () => {
		const cells = [
			makeCell('steps', [
				{ id: 'A', label: 'Start' },
				{ id: 'B', label: 'End' }
			])
		];
		const src = `{% mermaid %}
graph TD
{% each data=$steps.rows %}
  $id["$label"]
{% /each %}
{% /mermaid %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const code = findTag(tree, 'mermaid')?.attributes.code as string;
		expect(code).toContain('graph TD\n');
		expect(code).toContain('A["Start"]');
		expect(code).toContain('B["End"]');
		expect(code).toContain('\n  A["Start"]');
	});

	it('expands flowchart subgraph swimlanes from group/each without glued tokens', () => {
		const tasks = [
			{ id: 1, title: 'Design login page', status: 'Todo', ticket: 'T-001' },
			{ id: 3, title: 'Write API docs', status: 'Todo', ticket: 'T-003' },
			{ id: 2, title: 'Fix auth bug', status: 'In Progress', ticket: 'T-002' }
		];
		const cells = [makeCell('tasks', tasks)];
		// No blank lines inside {% each %} — Markdoc treats them as block boundaries.
		const src = `{% mermaid %}
flowchart LR
  {% group data=$tasks.rows by="status" order=["Todo","In Progress","Review","Done"] %}
  subgraph $keyId["$key"]
  {% each data=$items %}
  t$id["$title · $ticket"]
  {% /each %}
  end
  {% /group %}
  todo --> in_progress --> review --> done
{% /mermaid %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const code = findTag(tree, 'mermaid')?.attributes.code as string;
		expect(code).toContain('subgraph todo["Todo"]');
		expect(code).toContain('t1["Design login page · T-001"]');
		expect(code).toContain('\n  t1["Design login page · T-001"]');
		expect(code).toContain('t3["Write API docs · T-003"]');
		expect(code).toContain('\n  end');
		expect(code).toContain('todo --> in_progress --> review --> done');
		expect(code.match(/todo --> in_progress --> review --> done/g)?.length).toBe(1);
	});

	it('expands mindmap preserving template indentation', () => {
		const tasks = [
			{ id: 1, title: 'Design login page', status: 'Todo', assignee: 'Alice', ticket: 'T-001' },
			{ id: 2, title: 'Fix auth bug', status: 'In Progress', assignee: 'Bob', ticket: 'T-002' }
		];
		const cells = [makeCell('tasks', tasks)];
		const src = `{% mermaid %}
mindmap
  root((Sprint backlog))
  {% group data=$tasks.rows by="status" order=["Todo","In Progress","Review","Done"] %}
    $keyId("$key")
      {% each data=$items %}
      ("$title · $assignee · $ticket")
      {% /each %}
  {% /group %}
{% /mermaid %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const code = findTag(tree, 'mermaid')?.attributes.code as string;
		expect(code).toContain('root((Sprint backlog))');
		expect(code).toContain('    todo("Todo")');
		expect(code).toContain('      ("Design login page · Alice · T-001")');
		expect(code).toContain('    in_progress("In Progress")');
		expect(code).not.toMatch(/^todo\(/m);
	});

	it('expands sankey-beta with title and data rows on separate lines', () => {
		const tasks = [
			{ status: 'Todo', assignee: 'Alice' },
			{ status: 'In Progress', assignee: 'Bob' }
		];
		const cells = [makeCell('tasks', tasks)];
		const src = `{% mermaid %}
sankey-beta
  title Task flow: status → assignee
  {% each data=$tasks.rows %}
  $status, $assignee, 1
  {% /each %}
{% /mermaid %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const code = findTag(tree, 'mermaid')?.attributes.code as string;
		const lines = code.split('\n');
		expect(lines[1]).toBe('  title Task flow: status → assignee');
		expect(lines[1]).not.toContain('Todo');
		expect(code).toContain('Todo, Alice, 1');
		expect(code).toContain('In Progress, Bob, 1');
		expect(code).not.toMatch(/assignee[^\n]*Todo/);
	});

	it('expands sankey when {% each %} is on the same line as the title', () => {
		const tasks = [{ status: 'Todo', assignee: 'Alice' }];
		const cells = [makeCell('tasks', tasks)];
		const src = `{% mermaid %}
sankey-beta
  title Task flow: status → assignee  {% each data=$tasks.rows %}
  $status, $assignee, 1
  {% /each %}
{% /mermaid %}`;
		const code = findTag(renderMarkdocCell(src, cells).tree, 'mermaid')?.attributes.code as string;
		expect(code).toContain('title Task flow: status → assignee');
		expect(code).toContain('Todo, Alice, 1');
		expect(code).not.toMatch(/assignee[^\n]*Todo/);
	});

	it('normalizeMermaidCode splits glued sankey title and CSV rows', () => {
		const glued = `sankey-beta
  title Task flow: status → assignee  Todo, Alice, 1`;
		const fixed = normalizeMermaidCode(glued);
		expect(fixed).toContain('title Task flow: status → assignee\nTodo, Alice, 1');
		expect(fixed).not.toMatch(/assignee[^\n]*Todo/);
	});

	it('expands group/each outside mermaid with bare $field interpolation', () => {
		const cells = [
			makeCell('tasks', [
				{ id: 1, title: 'A', status: 'Todo' },
				{ id: 2, title: 'B', status: 'Done' }
			])
		];
		// Markdoc requires each/group body tags to be tightly nested (no prose between block siblings).
		const src =
			'{% group data=$tasks.rows by="status" %}{% each data=$items %}$key: $title\n{% /each %}{% /group %}';
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const text = textOf(tree);
		expect(text).toContain('Todo: A');
		expect(text).toContain('Done: B');
	});
});

describe('extractMarkdocRefs', () => {
	it('extracts top-level variable names including inside function calls', () => {
		const refs = extractMarkdocRefs('{% $orders.revenue %} and {% currency($prev.total) %}');
		expect(refs).toContain('orders');
		expect(refs).toContain('prev');
		expect(refs).toHaveLength(2);
	});

	it('extracts variable names used as tag attributes', () => {
		const refs = extractMarkdocRefs('{% metric value=$orders.revenue vs=$prev.revenue /%}');
		expect(refs.sort()).toEqual(['orders', 'prev']);
	});

	it('returns empty array for no refs', () => {
		expect(extractMarkdocRefs('plain text')).toEqual([]);
	});
});
