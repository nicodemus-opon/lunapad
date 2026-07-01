import { describe, expect, it } from 'vitest';
import { routeAgentIntent } from './intent-router.js';

describe('intent-router', () => {
	it('respects forced sprint mode', () => {
		const r = routeAgentIntent('anything', 'sprint');
		expect(r.intent).toBe('creation');
		expect(r.loop).toBe('sprint');
		expect(r.tier).toBe('forced');
	});

	it('classifies investigate-only prompts', () => {
		const r = routeAgentIntent('explore the orders table structure');
		expect(r.intent).toBe('investigation');
		expect(r.loop).toBe('investigation');
	});

	it('keeps casual show-me requests on the standard loop', () => {
		const r = routeAgentIntent('Show me a note about the data');
		expect(r.intent).toBe('standard');
		expect(r.loop).toBe('standard');
	});
});
