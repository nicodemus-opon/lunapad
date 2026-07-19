import { describe, expect, it } from 'vitest';
import { normalizeNotebookToolArgs } from './notebook-tool-normalize';

describe('AI chat notebook tool normalization', () => {
	it('repairs minor blueprint issues before emitting notebook tool calls', () => {
		const args = normalizeNotebookToolArgs('apply_notebook_patch', {
			blueprint: {
				blocks: [
					{
						type: 'grid',
						cols: 9,
						items: [
							{ type: 'metric', value: 12, label: 'Bad icon', icon: 'NoSuchIcon' },
							{ type: 'chart', chartType: 'radar', data: '$rows.rows' }
						]
					},
					{ type: 'filter', kind: 'giant-select', param: 'region', label: 'Region' }
				]
			}
		});

		const blueprint = args.blueprint as {
			blocks: Array<Record<string, unknown> & { items?: Array<Record<string, unknown>> }>;
		};
		expect(blueprint.blocks[0]).toMatchObject({ type: 'grid', cols: 4 });
		expect(blueprint.blocks[0].items?.[0]).not.toHaveProperty('icon');
		expect(blueprint.blocks[1]).toMatchObject({ type: 'chart', chartType: 'table' });
		expect(blueprint.blocks[2]).toMatchObject({ type: 'filter', kind: 'dropdown' });
		expect(args).not.toHaveProperty('_autoRepairLog');
	});

	it('preserves fatal unknown refs for compiler validation instead of hiding them', () => {
		const args = normalizeNotebookToolArgs('create_notebook', {
			blueprint: {
				blocks: [{ type: 'text', content: 'Uses $missing.value' }]
			}
		});
		expect(args).toMatchObject({
			blueprint: {
				blocks: [{ type: 'text', content: 'Uses $missing.value' }]
			}
		});
	});

	it('repairs chart config aliases before client-side notebook mutation', () => {
		const args = normalizeNotebookToolArgs('create_notebook', {
			blueprint: {
				blocks: [
					{
						type: 'plot',
						resultChartConfig: {
							chartType: 'area',
							xColumn: 'week',
							yColumn: 'active_users'
						},
						dataRef: '$weekly_active_users'
					}
				]
			}
		});

		expect(args).toMatchObject({
			blueprint: {
				blocks: [
					{
						type: 'chart',
						chartType: 'area',
						data: '$weekly_active_users.rows',
						x: 'week',
						y: 'active_users'
					}
				]
			}
		});
	});
});
