import { describe, expect, it } from 'vitest';
import { buildPythonIntelDescriptors } from './completions';

describe('buildPythonIntelDescriptors', () => {
	it('includes upstream cell outputs as bare globals for python intel', () => {
		const descriptors = buildPythonIntelDescriptors(
			[
				{
					canonicalName: 'analytics.public.orders',
					source: 'external',
					aliases: ['analytics.public.orders', 'public.orders'],
					attributeAlias: null,
					columns: ['id'],
					columnTypes: ['BIGINT']
				}
			],
			[{ name: 'sales_summary', columns: ['id', 'amount'] }]
		);

		expect(descriptors).toEqual([
			expect.objectContaining({
				canonicalName: 'sales_summary',
				source: 'cell',
				bindBareGlobal: 'sales_summary',
				attributeAlias: 'sales_summary',
				columns: ['id', 'amount']
			}),
			expect.objectContaining({
				canonicalName: 'analytics.public.orders',
				source: 'external'
			})
		]);
	});
});
