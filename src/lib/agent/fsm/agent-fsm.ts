/**
 * Explicit agent finite-state machine — replaces ad-hoc while-loop stall counters.
 */

export type AgentStateId =
	| 'route'
	| 'discovery'
	| 'modeling'
	| 'plan_gate'
	| 'sql_gen'
	| 'review'
	| 'agent_turn'
	| 'tool_exec'
	| 'stall_recovery'
	| 'done';

export interface AgentFsmContext {
	state: AgentStateId;
	turn: number;
	maxTurns: number;
	stallRetries: number;
	maxStallRetries: number;
	loop: string;
	signalledDone: boolean;
	hadToolCalls: boolean;
	lastError?: string;
}

export interface AgentFsmTransition {
	next: AgentStateId;
	reason: string;
}

export function createFsmContext(opts: {
	loop: string;
	maxTurns?: number;
	maxStallRetries?: number;
}): AgentFsmContext {
	return {
		state: 'route',
		turn: 0,
		maxTurns: opts.maxTurns ?? 30,
		stallRetries: 0,
		maxStallRetries: opts.maxStallRetries ?? 3,
		loop: opts.loop,
		signalledDone: false,
		hadToolCalls: false
	};
}

export function transitionFsm(
	ctx: AgentFsmContext,
	event:
		| { type: 'routed'; loop: string }
		| { type: 'tools_done' }
		| { type: 'plan_proposal' }
		| { type: 'plan_approved' }
		| { type: 'tool_calls' }
		| { type: 'prose_only' }
		| { type: 'done' }
		| { type: 'error'; message: string }
): AgentFsmTransition {
	switch (ctx.state) {
		case 'route': {
			if (event.type !== 'routed') return { next: 'route', reason: 'awaiting route' };
			if (event.loop === 'pipeline') return { next: 'discovery', reason: 'creation pipeline' };
			if (event.loop === 'sprint') return { next: 'discovery', reason: 'sprint pipeline' };
			if (event.loop === 'debug') return { next: 'agent_turn', reason: 'debug loop' };
			if (event.loop === 'investigation') return { next: 'agent_turn', reason: 'read-only' };
			return { next: 'agent_turn', reason: 'standard loop' };
		}
		case 'discovery':
			if (event.type === 'tools_done') return { next: 'modeling', reason: 'discovery complete' };
			return { next: 'tool_exec', reason: 'discovery tools' };
		case 'modeling':
			if (event.type === 'plan_proposal') return { next: 'plan_gate', reason: 'await approval' };
			if (event.type === 'tools_done') return { next: 'sql_gen', reason: 'modeling complete' };
			return { next: 'tool_exec', reason: 'modeling tools' };
		case 'plan_gate':
			if (event.type === 'plan_approved') return { next: 'sql_gen', reason: 'approved' };
			return { next: 'plan_gate', reason: 'waiting' };
		case 'sql_gen':
			if (event.type === 'tools_done') return { next: 'review', reason: 'cells built' };
			return { next: 'tool_exec', reason: 'sql-gen tools' };
		case 'review':
			if (event.type === 'done') return { next: 'done', reason: 'review passed' };
			return { next: 'agent_turn', reason: 'review turn' };
		case 'agent_turn':
			ctx.turn++;
			if (event.type === 'done') return { next: 'done', reason: 'signalled done' };
			if (event.type === 'tool_calls') {
				ctx.hadToolCalls = true;
				ctx.stallRetries = 0;
				return { next: 'tool_exec', reason: 'execute tools' };
			}
			if (event.type === 'prose_only') {
				if (ctx.stallRetries < ctx.maxStallRetries && ctx.turn < ctx.maxTurns) {
					ctx.stallRetries++;
					return { next: 'stall_recovery', reason: 'stall nudge' };
				}
				return { next: 'done', reason: 'max stalls' };
			}
			if (event.type === 'error') {
				ctx.lastError = event.message;
				return { next: 'stall_recovery', reason: 'error recovery' };
			}
			if (ctx.turn >= ctx.maxTurns) return { next: 'done', reason: 'max depth' };
			return { next: 'agent_turn', reason: 'continue' };
		case 'tool_exec':
			return { next: 'agent_turn', reason: 'results injected' };
		case 'stall_recovery':
			return { next: 'agent_turn', reason: 'nudged' };
		case 'done':
			return { next: 'done', reason: 'terminal' };
		default:
			return { next: 'done', reason: 'unknown' };
	}
}

export function applyTransition(ctx: AgentFsmContext, t: AgentFsmTransition): void {
	ctx.state = t.next;
	if (t.next === 'done') ctx.signalledDone = true;
}
