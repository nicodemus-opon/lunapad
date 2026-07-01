import { describe, expect, it } from 'vitest';
import { evaluateAlertRule, resolveMetricFromRows } from './share-alerts';

describe('share-alerts', () => {
	it('evaluates threshold rules', () => {
		expect(evaluateAlertRule(10, 'gt', 5)).toBe(true);
		expect(evaluateAlertRule(5, 'gt', 5)).toBe(false);
	});

	it('resolves metric from snapshot rows', () => {
		const map = new Map([['monthly_revenue', [{ total_revenue: 1200 }]]]);
		expect(resolveMetricFromRows('monthly_revenue.total_revenue', map)).toBe(1200);
	});
});
