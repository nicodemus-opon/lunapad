import { describe, it, expect } from 'vitest';
import Markdoc, { Tag } from '@markdoc/markdoc';
import { buildContextualMarkdocSnippet } from './markdoc-contextual-snippets';
import { MARKDOC_TAG_CATALOG } from './markdoc-catalog';
import {
	buildMarkdocVariables,
	renderMarkdocCell,
	extractMarkdocRefs,
	validateMarkdocMarkdown,
	normalizeMarkdocFirstRowRefs,
	normalizeMermaidCode
} from './markdoc-interp.js';
import { WIDGET_SNIPPETS } from './markdoc-snippets';
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

function findTags(nodes: unknown, name: string): Tag[] {
	const out: Tag[] = [];
	for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
		if (Tag.isTag(node)) {
			if ((node as Tag).name === name) out.push(node as Tag);
			out.push(...findTags((node as Tag).children, name));
		}
	}
	return out;
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

	it('includes python cells with dataframe results', () => {
		const pyCell = {
			...makeCell('py_result', [{ People: 2, Share: 50 }]),
			cellType: 'python'
		} as Cell;
		const vars = buildMarkdocVariables([pyCell]);
		expect(vars.py_result).toMatchObject({ People: 2, Share: 50, count: 1 });
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

	it('normalizes rows.0 first-row refs', () => {
		expect(normalizeMarkdocFirstRowRefs('$orders.rows.0.total')).toBe('$orders.total');
		expect(normalizeMarkdocFirstRowRefs('$orders.rows[0].total')).toBe('$orders.total');
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

	it('renders a callout title passthrough', () => {
		const { tree } = renderMarkdocCell(
			'{% callout type="warning" title="Heads up" %}\nBody.\n{% /callout %}',
			[]
		);
		const callout = findTag(tree, 'callout');
		expect(callout?.attributes.type).toBe('warning');
		expect(callout?.attributes.title).toBe('Heads up');
	});

	it('renders a video tag passthrough', () => {
		const { tree, errors } = renderMarkdocCell(
			'{% video src="https://example.com/a.mp4" loop=true muted=true /%}',
			[]
		);
		expect(errors).toEqual([]);
		const video = findTag(tree, 'video');
		expect(video?.attributes.src).toBe('https://example.com/a.mp4');
		expect(video?.attributes.loop).toBe(true);
		expect(video?.attributes.muted).toBe(true);
	});

	it('renders an embed tag passthrough with default aspect', () => {
		const { tree } = renderMarkdocCell(
			'{% embed url="https://www.youtube.com/watch?v=abc123" /%}',
			[]
		);
		const embed = findTag(tree, 'embed');
		expect(embed?.attributes.url).toBe('https://www.youtube.com/watch?v=abc123');
		expect(embed?.attributes.aspect).toBe('16:9');
	});

	it('renders a bookmark tag passthrough', () => {
		const { tree } = renderMarkdocCell(
			'{% bookmark url="https://example.com" title="Example" description="A site" /%}',
			[]
		);
		const bookmark = findTag(tree, 'bookmark');
		expect(bookmark?.attributes.url).toBe('https://example.com');
		expect(bookmark?.attributes.title).toBe('Example');
		expect(bookmark?.attributes.description).toBe('A site');
	});

	it('renders a math tag passthrough with default display', () => {
		const { tree, errors } = renderMarkdocCell('{% math latex="E = mc^2" /%}', []);
		expect(errors).toEqual([]);
		const math = findTag(tree, 'math');
		expect(math?.attributes.latex).toBe('E = mc^2');
		expect(math?.attributes.display).toBe(false);
	});

	it('renders a math tag with display=true', () => {
		const { tree } = renderMarkdocCell('{% math latex="x^2" display=true /%}', []);
		const math = findTag(tree, 'math');
		expect(math?.attributes.display).toBe(true);
	});

	it('renders a toc tag passthrough', () => {
		const { tree, errors } = renderMarkdocCell('{% toc /%}', []);
		expect(errors).toEqual([]);
		expect(findTag(tree, 'toc')).toBeTruthy();
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

	it('translates raw Markdoc "missing closing" tokenizer errors into actionable text', () => {
		// An {% if %} with no matching {% /if %} — Markdoc's parser flags this as a
		// critical-level "Node 'if' is missing closing" error, which used to reach the
		// UI verbatim as parser-internals jargon.
		const unclosed = '{% if $orders.count %}\nSome text';
		const diags = validateMarkdocMarkdown(unclosed, [makeCell('orders', [{ count: 1 }])]);
		expect(diags.some((d) => /is missing closing/i.test(d.message))).toBe(false);
		expect(
			diags.some((d) => /Malformed markdown.*unclosed or extra 'if' block/i.test(d.message))
		).toBe(true);

		const { errors } = renderMarkdocCell(unclosed, [makeCell('orders', [{ count: 1 }])]);
		expect(errors.some((e) => /is missing closing/i.test(e))).toBe(false);
		expect(errors.some((e) => /Malformed markdown.*unclosed or extra 'if' block/i.test(e))).toBe(
			true
		);
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

	it('expands plain each loops even with blank lines in the body', () => {
		const cells = [
			makeCell('orders', [
				{ customer_name: 'Alice', revenue: 120 },
				{ customer_name: 'Bob', revenue: 80 }
			])
		];
		const src = `{% each data=$orders.rows %}

- $customer_name: $revenue

{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const text = textOf(tree);
		expect(text).toContain('Alice: 120');
		expect(text).toContain('Bob: 80');
		expect(text).not.toContain('$customer_name');
	});

	it('resolves dotted properties inside each loop bodies', () => {
		const cells = [
			makeCell('orders', [
				{ customer: { name: 'Alice', tier: 'Gold' } },
				{ customer: { name: 'Bob', tier: 'Silver' } }
			])
		];
		const src = `{% each data=$orders.rows %}
- $customer.name ($customer.tier)
{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const text = textOf(tree);
		expect(text).toContain('Alice (Gold)');
		expect(text).toContain('Bob (Silver)');
		expect(text).not.toContain('[object Object]');
	});

	it('exposes a singular current-item alias for ref-backed each loops', () => {
		const cells = [
			makeCell('users', [
				{ name: 'Alice', role: 'Admin' },
				{ name: 'Bob', role: 'Member' }
			])
		];
		const src = `{% each data=$users.rows %}
- $user.name ($user.role)
{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const text = textOf(tree);
		expect(text).toContain('Alice (Admin)');
		expect(text).toContain('Bob (Member)');
	});

	it('supports singular aliases in unquoted tag attributes inside each loops', () => {
		const cells = [
			makeCell('users', [
				{ name: 'Alice', role: 'Admin' },
				{ name: 'Bob', role: 'Member' }
			])
		];
		const src = `{% each data=$users.rows %}
{% card title=$user.name %}
{% /card %}
{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const cards = findTags(tree, 'card');
		expect(cards.map((card) => card.attributes.title)).toEqual(['Alice', 'Bob']);
	});

	it('keeps object aliases parse-safe inside quoted tag attributes', () => {
		const cells = [
			makeCell('users', [
				{ name: 'Alice', role: 'Admin' },
				{ name: 'Bob', role: 'Member' }
			])
		];
		const src = `{% each data=$users.rows %}
{% card title="$user" %}
{% /card %}
{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const cards = findTags(tree, 'card');
		expect(String(cards[0]?.attributes.title)).toContain('"name":"Alice"');
		expect(String(cards[1]?.attributes.title)).toContain('"name":"Bob"');
	});

	it('exposes $item for primitive each data', () => {
		const { tree, errors } = renderMarkdocCell(
			'{% each data=["Alice","Bob"] %}- $item\n{% /each %}',
			[]
		);
		expect(errors).toEqual([]);
		const text = textOf(tree);
		expect(text).toContain('Alice');
		expect(text).toContain('Bob');
	});

	it('does not interpolate ordinary bare refs outside loop blocks during pre-expansion', () => {
		const cells = [makeCell('orders', [{ customer_name: 'Alice', revenue: 120 }])];
		const src = `Literal prose keeps $orders.revenue.

{% each data=$orders.rows %}
- $customer_name
{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const text = textOf(tree);
		expect(text).toContain('Literal prose keeps $orders.revenue.');
		expect(text).toContain('Alice');
	});

	it('renders nested Markdoc widgets inside each loops', () => {
		const cells = [
			makeCell('orders', [
				{ customer_name: 'Alice', revenue: 120, region: 'West' },
				{ customer_name: 'Bob', revenue: 80, region: 'East' }
			])
		];
		const src = `{% each data=$orders.rows %}
{% card title="$customer_name" %}
{% metric value=$revenue label="Revenue" /%}
{% badge value="$region" /%}
{% /card %}
{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const cards = findTags(tree, 'card');
		const metrics = findTags(tree, 'metric');
		const badges = findTags(tree, 'badge');
		expect(cards).toHaveLength(2);
		expect(cards.map((card) => card.attributes.title)).toEqual(['Alice', 'Bob']);
		expect(metrics.map((metric) => metric.attributes.value)).toEqual([120, 80]);
		expect(badges.map((badge) => badge.attributes.value)).toEqual(['West', 'East']);
	});

	it('resolves dotted properties inside widget attributes rendered by each loops', () => {
		const cells = [
			makeCell('orders', [
				{ customer: { name: 'Alice' }, stats: { revenue: 120 } },
				{ customer: { name: 'Bob' }, stats: { revenue: 80 } }
			])
		];
		const src = `{% each data=$orders.rows %}
{% card title="$customer.name" %}
{% metric value=$stats.revenue label="$customer.name" /%}
{% /card %}
{% /each %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const cards = findTags(tree, 'card');
		const metrics = findTags(tree, 'metric');
		expect(cards.map((card) => card.attributes.title)).toEqual(['Alice', 'Bob']);
		expect(metrics.map((metric) => metric.attributes.value)).toEqual([120, 80]);
		expect(metrics.map((metric) => metric.attributes.label)).toEqual(['Alice', 'Bob']);
	});

	it('groups rows by dotted properties', () => {
		const cells = [
			makeCell('orders', [
				{ customer: { region: 'West', name: 'Alice' } },
				{ customer: { region: 'West', name: 'Anya' } },
				{ customer: { region: 'East', name: 'Bob' } }
			])
		];
		const src =
			'{% group data=$orders.rows by="customer.region" %}{% each data=$items %}$key: $customer.name\n{% /each %}{% /group %}';
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const text = textOf(tree);
		expect(text).toContain('West: Alice');
		expect(text).toContain('West: Anya');
		expect(text).toContain('East: Bob');
	});

	it('renders nested conditionals and widgets inside group loops', () => {
		const cells = [
			makeCell('orders', [
				{ customer_name: 'Alice', revenue: 120, region: 'West' },
				{ customer_name: 'Bob', revenue: 80, region: 'East' }
			])
		];
		const src = `{% group data=$orders.rows by="region" %}
{% card title="$key" %}
{% each data=$items %}
{% if gt($revenue, 100) %}
{% metric value=$revenue label="$customer_name" /%}
{% else /%}
{% badge value="$customer_name" /%}
{% /if %}
{% /each %}
{% /card %}
{% /group %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		const cards = findTags(tree, 'card');
		const metrics = findTags(tree, 'metric');
		const badges = findTags(tree, 'badge');
		expect(cards.map((card) => card.attributes.title).sort()).toEqual(['East', 'West']);
		expect(metrics.map((metric) => metric.attributes.value)).toEqual([120]);
		expect(metrics.map((metric) => metric.attributes.label)).toEqual(['Alice']);
		expect(badges.map((badge) => badge.attributes.value)).toEqual(['Bob']);
	});

	it('renders tabs with nested columns, metrics, charts, and prose', () => {
		const cells = [
			makeCell('orders', [
				{ region: 'West', revenue: 120 },
				{ region: 'East', revenue: 80 }
			])
		];
		const src = `{% tabs %}
{% tab label="Overview" %}
Intro prose
{% columns %}
{% column %}
{% metric value=$orders.count label="Rows" /%}
{% /column %}
{% column %}
{% chart type="bar" data=$orders.rows x="region" y="revenue" /%}
{% /column %}
{% /columns %}
{% /tab %}
{% /tabs %}`;
		const { tree, errors } = renderMarkdocCell(src, cells);
		expect(errors).toEqual([]);
		expect(findTag(tree, 'tabs')).toBeDefined();
		expect(findTag(tree, 'tab')?.attributes.label).toBe('Overview');
		expect(findTag(tree, 'metric')?.attributes.value).toBe(2);
		expect(findTag(tree, 'chart')?.attributes.data).toHaveLength(2);
		expect(textOf(tree)).toContain('Intro prose');
	});

	it('renders contextual report recipes with nested widgets', () => {
		const cells = [
			makeCell('orders', [
				{ customer_name: 'Alice', revenue: 120, region: 'West' },
				{ customer_name: 'Bob', revenue: 80, region: 'East' }
			])
		];
		const refs = [
			{
				cellName: 'orders',
				columns: [
					{ name: 'customer_name', type: 'varchar' },
					{ name: 'revenue', type: 'double' },
					{ name: 'region', type: 'varchar' }
				]
			}
		];

		for (const recipe of ['report-summary', 'report-filtered', 'report-grouped', 'report-tabs']) {
			const source = buildContextualMarkdocSnippet(recipe, refs);
			const { tree, errors } = renderMarkdocCell(source, cells);
			expect(errors, recipe).toEqual([]);
			expect(
				findTag(tree, 'datatable') || findTag(tree, 'chart') || findTag(tree, 'card')
			).toBeDefined();
		}
	});

	it('renders every standalone fallback widget snippet without notebook refs', () => {
		for (const [name, source] of Object.entries(WIDGET_SNIPPETS)) {
			if (name === 'else') continue;
			const { tree, errors } = renderMarkdocCell(source, []);
			expect(errors, name).toEqual([]);
			expect(tree, name).toBeDefined();
			expect(validateMarkdocMarkdown(source, []), name).toEqual([]);
		}
	});

	it('renders every contextual Markdoc tag snippet against a real result', () => {
		const cells = [
			makeCell(
				'orders',
				[
					{ customer_name: 'Alice', revenue: 120, region: 'West' },
					{ customer_name: 'Bob', revenue: 80, region: 'East' }
				],
				['customer_name', 'revenue', 'region']
			)
		];
		const refs = [
			{
				cellName: 'orders',
				rowCount: 2,
				columns: [
					{ name: 'customer_name', type: 'varchar' },
					{ name: 'revenue', type: 'double' },
					{ name: 'region', type: 'varchar' }
				]
			}
		];

		for (const tagName of Object.keys(MARKDOC_TAG_CATALOG)) {
			if (tagName === 'else') continue;
			const source = buildContextualMarkdocSnippet(tagName, refs);
			expect(source.length, tagName).toBeGreaterThan(0);
			const { tree, errors } = renderMarkdocCell(source, cells);
			expect(errors, tagName).toEqual([]);
			expect(tree, tagName).toBeDefined();
		}
	});

	it('renders contextual callout prose expressions instead of literal refs', () => {
		const cells = [makeCell('orders', [{ region: 'North', revenue: 120 }])];
		const refs = [
			{
				cellName: 'orders',
				rowCount: 1,
				columns: [
					{ name: 'region', type: 'varchar' },
					{ name: 'revenue', type: 'double' }
				]
			}
		];
		const source = buildContextualMarkdocSnippet('callout', refs);
		const { tree, errors } = renderMarkdocCell(source, cells);
		expect(errors).toEqual([]);
		expect(textOf(tree)).toContain('Review 1 rows before publishing.');
		expect(textOf(tree)).not.toContain('$orders.count');
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
