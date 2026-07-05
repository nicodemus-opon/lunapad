import { describe, expect, it } from 'vitest';
import { contextualSnippet } from '../components/markdown/visual/slash-command-extension';
import { MARKDOC_TAG_CATALOG } from './markdoc-catalog';
import { SLASH_COMMANDS, WIDGET_SNIPPETS } from './markdown-format';

describe('visual dashboard slash commands', () => {
	it('includes advanced dashboard authoring snippets', () => {
		const byId = new Map(SLASH_COMMANDS.map((cmd) => [cmd.id, cmd]));
		expect(byId.get('summary-table')?.snippet).toBe(WIDGET_SNIPPETS.summaryTable);
		expect(byId.get('pivot-table')?.snippet).toBe(WIDGET_SNIPPETS.pivotTable);
		expect(byId.get('conditional')?.snippet).toContain('{% if gt(');
		expect(byId.get('mermaid-loop')?.snippet).toContain('{% group');
	});

	it('surfaces report-level workflow commands before raw Markdoc tags', () => {
		const reportIds = ['report-summary', 'report-filtered', 'report-grouped', 'report-tabs'];
		expect(SLASH_COMMANDS.slice(0, 12).map((cmd) => cmd.id)).toEqual(
			expect.arrayContaining(reportIds)
		);
		for (const id of reportIds) {
			const cmd = SLASH_COMMANDS.find((item) => item.id === id);
			expect(cmd?.group).toBe('report');
		}
	});

	it('derives slash commands for every cataloged Markdoc tag', () => {
		const byId = new Map(SLASH_COMMANDS.map((cmd) => [cmd.id, cmd]));
		for (const [tagName, tag] of Object.entries(MARKDOC_TAG_CATALOG)) {
			expect(byId.get(tagName)?.snippet).toBe(tag.slashSnippet);
		}
		expect(byId.get('each')?.snippet).toContain('{% each data=[{title:"Example"');
		expect(byId.get('each')?.snippet).toContain('{% card title="$title" %}');
		expect(byId.get('group')?.snippet).toContain('{% group data=[{group_column:"A"');
		expect(byId.get('group')?.snippet).toContain('{% each data=$items %}');
	});

	it('contextualizes loop snippets with existing result refs and columns', () => {
		const byId = new Map(SLASH_COMMANDS.map((cmd) => [cmd.id, cmd]));
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

		expect(contextualSnippet(byId.get('each')!, refs)).toContain(
			'{% each data=$orders.rows %}\n{% card title="$customer_name" %}'
		);
		expect(contextualSnippet(byId.get('group')!, refs)).toContain(
			'{% group data=$orders.rows by="customer_name" %}'
		);
		expect(contextualSnippet(byId.get('mermaid-loop')!, refs)).toContain(
			'{% group data=$orders.rows by="customer_name" %}'
		);
	});

	it('does not invent data-bound snippets when there is no usable result context', () => {
		const byId = new Map(SLASH_COMMANDS.map((cmd) => [cmd.id, cmd]));
		const emptyRefs = [
			{
				cellName: 'result1',
				rowCount: 0,
				columns: [
					{ name: 'order_id', type: 'number' },
					{ name: 'order_date', type: 'date' }
				]
			}
		];

		expect(contextualSnippet(byId.get('each')!, [])).toBe(WIDGET_SNIPPETS.each);
		expect(contextualSnippet(byId.get('each')!, emptyRefs)).toBe(WIDGET_SNIPPETS.each);
		expect(contextualSnippet(byId.get('report-summary')!, emptyRefs)).toBe('');
	});

	it('contextualizes every Markdoc tag command, not only loops', () => {
		const byId = new Map(SLASH_COMMANDS.map((cmd) => [cmd.id, cmd]));
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

		for (const tagName of Object.keys(MARKDOC_TAG_CATALOG)) {
			const cmd = byId.get(tagName);
			expect(cmd, `missing command for ${tagName}`).toBeDefined();
			const snippet = contextualSnippet(cmd!, refs);
			expect(snippet.length, `empty snippet for ${tagName}`).toBeGreaterThan(0);
		}

		expect(contextualSnippet(byId.get('metric')!, refs)).toBe(
			'{% metric value=$orders.revenue label="revenue" /%}'
		);
		expect(contextualSnippet(byId.get('chart')!, refs)).toContain(
			'{% chart type="bar" data=$orders.rows x="customer_name" y="revenue" /%}'
		);
		expect(contextualSnippet(byId.get('if')!, refs)).toContain('{% if gt($orders.count, 0) %}');
		expect(contextualSnippet(byId.get('report-filtered')!, refs)).toContain(
			'{% filter kind="dropdown" param="customer_name"'
		);
		expect(contextualSnippet(byId.get('report-tabs')!, refs)).toContain('{% tabs %}');
	});
});
