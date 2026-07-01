import { describe, expect, it } from 'vitest';
import { rowsToCsv } from './widget-export';

describe('widget-export', () => {
	it('serializes rows to csv', () => {
		const csv = rowsToCsv(
			['a', 'b'],
			[
				{ a: 1, b: 'x' },
				{ a: 2, b: 'y,z' }
			]
		);
		expect(csv).toBe('a,b\n1,x\n2,"y,z"');
	});
});
