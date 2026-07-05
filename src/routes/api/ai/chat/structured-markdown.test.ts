import { describe, expect, it } from 'vitest';
import {
	compileStructuredMarkdownArgs,
	hasDashboardResultContextFromMessages
} from './structured-markdown.js';
import type { AIChatCell } from '$lib/types/ai-chat.js';

const baseCells: AIChatCell[] = [
	{
		id: 'orders',
		outputName: 'orders',
		language: 'sql',
		cellType: 'query',
		code: '',
		resultColumns: ['count'],
		status: 'success'
	}
];

describe('compileStructuredMarkdownArgs', () => {
	it('treats run_cells results as valid dashboard render context', () => {
		expect(
			hasDashboardResultContextFromMessages([
				{ role: 'user', content: 'Build a notebook' },
				{
					role: 'assistant',
					content:
						"Tool results:\n\nrun_cells result:\nrevenue_by_month: success (12 rows, columns: month, total_revenue)"
				}
			])
		).toBe(true);
	});

	it('allows structured notebook markdown to reference cells created earlier in the same turn', () => {
		const result = compileStructuredMarkdownArgs(
			'create_cell',
			{
				outputName: 'findings',
				cellType: 'markdown',
				dashboard: {
					title: 'Notebook Findings',
					blocks: [
						{
							type: 'metric',
							value: '$revenue_by_month.total_revenue',
							label: 'Revenue',
							format: 'currency'
						}
					]
				}
			},
			baseCells,
			['orders', 'revenue_by_month']
		);

		expect(result.errors).toEqual([]);
		expect(result.args.markdown).toContain('$revenue_by_month.total_revenue');
	});

	it('still rejects unknown refs when they were not created earlier in the turn', () => {
		const result = compileStructuredMarkdownArgs(
			'create_cell',
			{
				outputName: 'findings',
				cellType: 'markdown',
				dashboard: {
					blocks: [{ type: 'metric', value: '$missing.total', label: 'Missing' }]
				}
			},
			baseCells,
			['orders']
		);

		expect(result.errors.join(' ')).toMatch(/unknown/i);
	});
});
