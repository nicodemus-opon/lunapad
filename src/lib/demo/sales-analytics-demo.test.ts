import { describe, expect, it } from 'vitest';
import { buildSalesAnalyticsDemo, DEMO_NOTEBOOK_NAME } from './sales-analytics-demo';
import { resolveDependencies } from '$lib/services/cell-deps';

const MARKDOC_REF_RE = /\$([a-z][a-z0-9_]*)/gi;

function queryOutputNames(notebook: ReturnType<typeof buildSalesAnalyticsDemo>): string[] {
	return notebook.cells
		.filter((c) => c.cellType === 'query' && c.outputName)
		.map((c) => c.outputName);
}

function markdocRefs(notebook: ReturnType<typeof buildSalesAnalyticsDemo>): string[] {
	const refs = new Set<string>();
	for (const cell of notebook.cells) {
		if (cell.cellType !== 'markdown') continue;
		for (const match of cell.markdown.matchAll(MARKDOC_REF_RE)) {
			refs.add(match[1]);
		}
	}
	return [...refs];
}

describe('buildSalesAnalyticsDemo', () => {
	const notebook = buildSalesAnalyticsDemo();

	it('uses the canonical demo notebook name', () => {
		expect(notebook.name).toBe(DEMO_NOTEBOOK_NAME);
	});

	it('has a stable cell count', () => {
		expect(notebook.cells).toHaveLength(15);
	});

	it('includes a python cell', () => {
		const pythonCells = notebook.cells.filter((c) => c.cellType === 'python');
		expect(pythonCells).toHaveLength(1);
		expect(pythonCells[0]?.outputName).toBeTruthy();
	});

	it('uses SQL for category_breakdown and top_products, GUI-pipeline PRQL for segment_breakdown', () => {
		const category = notebook.cells.find((c) => c.outputName === 'category_breakdown');
		const topProducts = notebook.cells.find((c) => c.outputName === 'top_products');
		const segment = notebook.cells.find((c) => c.outputName === 'segment_breakdown');
		expect(category?.language).toBe('sql');
		expect(topProducts?.language).toBe('sql');
		expect(segment?.language).toBe('prql');
		expect(segment?.editMode).toBe('gui');
		expect(segment?.guiStages.some((s) => s.type === 'filter')).toBe(true);
	});

	it('assigns unique output names to query cells', () => {
		const names = queryOutputNames(notebook);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain('orders');
		expect(names).toContain('quota_attainment');
		expect(names).toContain('segment_breakdown');
	});

	it('orders dependencies so upstream cells appear before downstream', () => {
		const cells = notebook.cells;
		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];
			if (cell.cellType !== 'query') continue;
			const deps = resolveDependencies(cells, i);
			for (const dep of deps) {
				const depIdx = cells.findIndex((c) => c.id === dep.id);
				expect(depIdx).toBeGreaterThanOrEqual(0);
				expect(depIdx).toBeLessThan(i);
			}
		}
	});

	it('references only existing output names in markdown cells', () => {
		const outputNames = new Set(queryOutputNames(notebook));
		const refs = markdocRefs(notebook);
		for (const ref of refs) {
			expect(outputNames.has(ref)).toBe(true);
		}
	});

	it('includes enriched markdoc widgets in markdown cells', () => {
		const markdown = notebook.cells
			.filter((c) => c.cellType === 'markdown')
			.map((c) => c.markdown)
			.join('\n');
		expect(markdown).toContain('{% tabs %}');
		expect(markdown).toContain('{% progress ');
		expect(markdown).toContain('{% badge ');
		expect(markdown).toContain('{% mermaid %}');
		expect(markdown).toContain('{% chart ');
	});

	it('seeds customer_segment on orders', () => {
		const orders = notebook.cells.find((c) => c.outputName === 'orders');
		expect(orders?.code).toContain('customer_segment');
	});
});
