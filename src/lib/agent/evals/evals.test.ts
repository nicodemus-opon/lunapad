import { describe, expect, it } from 'vitest';
import { evaluateScenario } from './assertions.js';
import { EVAL_SCENARIOS } from './scenarios.js';

describe('agent eval scenarios', () => {
	for (const scenario of EVAL_SCENARIOS) {
		it(`${scenario.id}: ${scenario.description}`, () => {
			const result = evaluateScenario(scenario);
			expect(result.failures, result.failures.join('; ')).toEqual([]);
			expect(result.passed).toBe(true);
		});
	}
});

describe('eval assertion engine', () => {
	it('detects missing investigate-before-create', () => {
		const result = evaluateScenario({
			id: 'bad',
			description: 'creates without sampling',
			prompt: 'test',
			transcript: [
				{
					role: 'assistant',
					toolCalls: [{ tool: 'create_cell', args: { outputName: 'x' } }]
				}
			],
			assertions: [{ type: 'tool_before_any_create', investigate: 'sample_data' }]
		});
		expect(result.passed).toBe(false);
		expect(result.failures.length).toBeGreaterThan(0);
	});
});
