import { describe, expect, it } from 'vitest';
import { createFsmContext, transitionFsm, applyTransition } from './agent-fsm.js';

describe('agent-fsm', () => {
	it('routes pipeline to discovery', () => {
		const ctx = createFsmContext({ loop: 'pipeline' });
		const t = transitionFsm(ctx, { type: 'routed', loop: 'pipeline' });
		expect(t.next).toBe('discovery');
		applyTransition(ctx, t);
		expect(ctx.state).toBe('discovery');
	});

	it('stall recovery after prose-only turn', () => {
		const ctx = createFsmContext({ loop: 'standard', maxTurns: 10 });
		applyTransition(ctx, transitionFsm(ctx, { type: 'routed', loop: 'standard' }));
		applyTransition(ctx, transitionFsm(ctx, { type: 'tool_calls' }));
		applyTransition(ctx, transitionFsm(ctx, { type: 'tools_done' }));
		const stall = transitionFsm(ctx, { type: 'prose_only' });
		expect(stall.next).toBe('stall_recovery');
	});
});
