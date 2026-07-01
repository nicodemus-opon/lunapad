import { describe, expect, it } from 'vitest';
import { buildUserContent } from './ai-user-content.js';
import type { AIChatCell } from '$lib/types/ai-chat.js';

function cell(partial: Partial<AIChatCell> & Pick<AIChatCell, 'id' | 'outputName' | 'code'>): AIChatCell {
	return {
		language: 'sql',
		resultColumns: [],
		status: 'idle',
		...partial
	};
}

describe('buildUserContent', () => {
	it('includes full code for attached context cells even when outputName is not in the message', () => {
		const cells = [
			cell({
				id: 'c1',
				outputName: 'revenue_by_month',
				code: 'SELECT month, SUM(amount) AS revenue FROM orders GROUP BY 1',
				isContextCell: true
			})
		];
		const out = buildUserContent(cells, [{ role: 'user', content: 'optimize this query' }]);
		expect(out).toContain('attached these notebook cells');
		expect(out).toContain('revenue_by_month');
		expect(out).toContain('SELECT month, SUM(amount)');
		expect(out).toContain('id=c1');
	});

	it('still includes code when outputName is mentioned in the message', () => {
		const cells = [cell({ id: 'c2', outputName: 'stg_orders', code: 'SELECT * FROM orders' })];
		const out = buildUserContent(cells, [
			{ role: 'user', content: 'fix stg_orders please' }
		]);
		expect(out).toContain('stg_orders');
		expect(out).toContain('SELECT * FROM orders');
	});

	it('includes error cell code without attachment or name mention', () => {
		const cells = [
			cell({
				id: 'c3',
				outputName: 'broken',
				code: 'SELECT bad_col FROM t',
				status: 'error',
				errorMessage: 'column not found'
			})
		];
		const out = buildUserContent(cells, [{ role: 'user', content: 'fix it' }]);
		expect(out).toContain('broken');
		expect(out).toContain('bad_col');
	});
});
