import { describe, expect, it } from 'vitest';
import { assertCatalogCompleteness, MARKDOC_TAG_CATALOG } from './markdoc-catalog';
import { CUSTOM_MARKDOC_TAGS } from './markdoc-interp';

describe('markdoc-catalog', () => {
	it('covers every custom runtime tag', () => {
		expect(() => assertCatalogCompleteness()).not.toThrow();
		for (const tag of CUSTOM_MARKDOC_TAGS) {
			expect(MARKDOC_TAG_CATALOG[tag]).toBeDefined();
		}
	});

	it('uses value= for badge (not label=)', () => {
		expect(MARKDOC_TAG_CATALOG.badge.snippet).toContain('value=');
		expect(MARKDOC_TAG_CATALOG.badge.snippet).not.toContain('label=');
	});

	it('includes grid, column, tab, group, each', () => {
		for (const tag of ['grid', 'column', 'tab', 'group', 'each'] as const) {
			expect(MARKDOC_TAG_CATALOG[tag]?.snippet.length).toBeGreaterThan(0);
		}
	});
});
