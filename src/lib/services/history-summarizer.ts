// Client-side trigger for rolling chat-history summarization. The actual LLM call happens
// server-side (`/api/ai/summarize-history`, reusing `callLLMJson`/`normalizeBaseUrl` from
// `$lib/server/ai-schema-context.ts`) — browsers don't call LLM endpoints directly anywhere
// else in this codebase (CORS, API-key handling), no reason to start here.

export interface SummarizeLLMConfig {
	provider: string;
	baseUrl: string;
	model: string;
	apiKey?: string;
}

export async function summarizeOlderTurns(
	messages: Array<{ role: 'user' | 'assistant'; content: string }>,
	llmConfig: SummarizeLLMConfig
): Promise<string> {
	const response = await fetch('/api/ai/summarize-history', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ messages, llmConfig })
	});
	const body = (await response.json()) as { summary?: string; error?: string };
	if (!response.ok || !body.summary) {
		throw new Error(body.error ?? 'Summarization failed');
	}
	return body.summary;
}
