import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATEGORIES, getDashboardTemplate } from './registry';
import { resolveDependencies } from '$lib/services/cell-deps';

const MARKDOC_REF_RE = /\$([a-z][a-z0-9_]*)/gi;

describe('template registry', () => {
	const allTemplates = TEMPLATE_CATEGORIES.flatMap((g) => g.templates);

	it('has at least 10 templates across analytics + starters', () => {
		expect(allTemplates.length).toBeGreaterThanOrEqual(10);
		const categories = new Set(TEMPLATE_CATEGORIES.map((g) => g.id));
		expect(categories.has('analytics')).toBe(true);
		expect(categories.has('starters')).toBe(true);
	});

	it('has unique template ids resolvable via getDashboardTemplate', () => {
		const ids = allTemplates.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(getDashboardTemplate(id)?.id).toBe(id);
		}
	});

	it('returns undefined for an unknown template id', () => {
		expect(getDashboardTemplate('not-a-real-template')).toBeUndefined();
	});

	for (const template of allTemplates) {
		describe(`"${template.id}"`, () => {
			const notebook = template.build();

			it('builds a notebook with unique cell ids and output names', () => {
				const cellIds = notebook.cells.map((c) => c.id);
				expect(new Set(cellIds).size).toBe(cellIds.length);

				const outputNames = notebook.cells
					.filter((c) => (c.cellType === 'query' || c.cellType === 'python') && c.outputName)
					.map((c) => c.outputName);
				expect(new Set(outputNames).size).toBe(outputNames.length);
			});

			it('orders dependencies so upstream cells appear before downstream', () => {
				const cells = notebook.cells;
				for (let i = 0; i < cells.length; i++) {
					if (cells[i].cellType !== 'query') continue;
					const deps = resolveDependencies(cells, i);
					for (const dep of deps) {
						const depIdx = cells.findIndex((c) => c.id === dep.id);
						expect(depIdx).toBeGreaterThanOrEqual(0);
						expect(depIdx).toBeLessThan(i);
					}
				}
			});

			it('references only existing output names in markdown cells', () => {
				const outputNames = new Set(
					notebook.cells
						.filter((c) => (c.cellType === 'query' || c.cellType === 'python') && c.outputName)
						.map((c) => c.outputName)
				);
				const refs = new Set<string>();
				for (const cell of notebook.cells) {
					if (cell.cellType !== 'markdown') continue;
					for (const match of cell.markdown.matchAll(MARKDOC_REF_RE)) {
						refs.add(match[1]);
					}
				}
				for (const ref of refs) {
					expect(outputNames.has(ref)).toBe(true);
				}
			});
		});
	}
});
