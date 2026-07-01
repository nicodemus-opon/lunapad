/**
 * Client-side browser bridge — polls for pending server-delegated tool calls.
 * When AGENT_KERNEL_SERVER is active, the server loop posts tool requests here.
 */

export interface BridgeToolRequest {
	sessionId: string;
	toolCallId: string;
	tool: string;
	args: Record<string, unknown>;
}

let _handler: ((req: BridgeToolRequest) => Promise<unknown>) | null = null;

export function registerBrowserBridgeHandler(
	handler: (req: BridgeToolRequest) => Promise<unknown>
): void {
	_handler = handler;
}

export async function pollBrowserBridge(sessionId: string): Promise<void> {
	// Placeholder: server pushes via WebSocket in future; for now no-op unless handler set.
	if (!_handler) return;
	void sessionId;
}

export async function submitBridgeResult(
	sessionId: string,
	toolCallId: string,
	result: unknown,
	error?: string
): Promise<void> {
	await fetch(`/api/ai/sessions/${sessionId}/execute`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ toolCallId, result, error })
	});
}
