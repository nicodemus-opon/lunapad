/**
 * Client-side agent telemetry — batched, fire-and-forget events for observability.
 */

export type AgentTelemetryEventType =
	| 'intent'
	| 'loop_start'
	| 'turn'
	| 'tool'
	| 'stall'
	| 'truncation'
	| 'rag_degraded'
	| 'loop_end'
	| 'stream_error';

export interface AgentTelemetryEvent {
	type: AgentTelemetryEventType;
	sessionId: string;
	timestamp: number;
	durationMs?: number;
	intent?: string;
	loop?: string;
	turn?: number;
	tool?: string;
	stallReason?: string;
	metadata?: Record<string, unknown>;
}

const MUTATING_TOOLS = new Set([
	'create_cell',
	'update_cell',
	'delete_cell',
	'run_cells',
	'move_cell',
	'set_chart',
	'pick_chart',
	'set_view_mode'
]);

let _sessionId = crypto.randomUUID();
let _queue: AgentTelemetryEvent[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

export function getAgentSessionId(): string {
	return _sessionId;
}

export function resetAgentSessionId(): void {
	_sessionId = crypto.randomUUID();
}

export function emitAgentTelemetry(
	partial: Omit<AgentTelemetryEvent, 'sessionId' | 'timestamp'>
): void {
	_queue.push({
		...partial,
		sessionId: _sessionId,
		timestamp: Date.now()
	});
	scheduleFlush();
}

export function isMutatingTool(tool: string): boolean {
	return MUTATING_TOOLS.has(tool);
}

function scheduleFlush(): void {
	if (_flushTimer) return;
	_flushTimer = setTimeout(() => {
		_flushTimer = null;
		void flushAgentTelemetry();
	}, 500);
}

export async function flushAgentTelemetry(): Promise<void> {
	if (_queue.length === 0) return;
	const batch = _queue.splice(0, 50);
	try {
		await fetch('/api/ai/telemetry', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ events: batch })
		});
	} catch {
		// Telemetry must never block or surface errors to the user.
	}
	if (_queue.length > 0) scheduleFlush();
}
