/**
 * Agent kernel public API — re-exports orchestration entry points.
 * Implementation lives in service modules during migration.
 */
export {
	submitAIMessage,
	resetAISession,
	undoAIChanges,
	undoLastAIStep,
	loadProjectMemoryIfNeeded,
	selectConversationHistory
} from '$lib/services/ai-chat-client.js';

export {
	emitAgentTelemetry,
	flushAgentTelemetry,
	getAgentSessionId,
	resetAgentSessionId,
	isMutatingTool
} from '$lib/agent/telemetry.js';

export { authorizeAITool, clearAIToolAuthCache } from '$lib/agent/tools/authorize.js';
