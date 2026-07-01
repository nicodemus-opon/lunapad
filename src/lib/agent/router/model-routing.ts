/**
 * Model routing and XML tool-call deprecation telemetry (Phase 5).
 */

import { emitAgentTelemetry } from '$lib/agent/telemetry.js';

let _xmlParseFailures = 0;
let _nativeParseFailures = 0;

export function recordToolParseFailure(provider: 'xml' | 'native'): void {
	if (provider === 'xml') _xmlParseFailures++;
	else _nativeParseFailures++;
	emitAgentTelemetry({
		type: 'tool',
		tool: '_parse_failure',
		metadata: { provider, xmlFailures: _xmlParseFailures, nativeFailures: _nativeParseFailures }
	});
}

export function getParseFailureStats(): { xml: number; native: number } {
	return { xml: _xmlParseFailures, native: _nativeParseFailures };
}

export interface ModelRoutingConfig {
	fastModel?: string;
	strongModel?: string;
	fallbackAfterParseFailures?: number;
}

let _routing: ModelRoutingConfig = { fallbackAfterParseFailures: 3 };

export function setModelRouting(config: ModelRoutingConfig): void {
	_routing = { ..._routing, ...config };
}

/** Pick model for a sub-task; falls back to primary when routing not configured. */
export function pickModelForTask(
	task: 'route' | 'sql_gen' | 'summarize',
	primaryModel: string
): string {
	if (task === 'route' && _routing.fastModel) return _routing.fastModel;
	if (task === 'sql_gen' && _routing.strongModel) return _routing.strongModel;
	if (task === 'summarize' && _routing.fastModel) return _routing.fastModel;
	return primaryModel;
}

export function shouldFallbackModel(): boolean {
	const threshold = _routing.fallbackAfterParseFailures ?? 3;
	return _xmlParseFailures >= threshold;
}
