import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callLLMJson, normalizeBaseUrl } from '$lib/server/ai-schema-context.js';

interface SummarizeHistoryRequest {
	messages: Array<{ role: 'user' | 'assistant'; content: string }>;
	llmConfig: { provider: string; baseUrl: string; model: string; apiKey?: string };
}

const SYSTEM_PROMPT = `You compress old chat-session turns into one short paragraph for an AI coding assistant's memory.
Capture: the task being worked on, key decisions made, data/schema facts learned, and any open threads.
CRITICAL: if any message contains a <plan>...</plan> block, copy it INTO your summary verbatim, unmodified — never paraphrase or drop it.
Return JSON: {"summary": "..."}. Keep the summary under 300 words.`;

export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<SummarizeHistoryRequest>;
	try {
		body = (await request.json()) as Partial<SummarizeHistoryRequest>;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		return json({ error: 'messages array is required' }, { status: 400 });
	}
	if (!body.llmConfig?.baseUrl?.trim() || !body.llmConfig?.model?.trim()) {
		return json({ error: 'llmConfig with baseUrl and model is required' }, { status: 400 });
	}

	const transcript = body.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 60_000);

	try {
		const completionUrl = `${normalizeBaseUrl(body.llmConfig.baseUrl)}/chat/completions`;
		const content = await callLLMJson({
			completionUrl,
			model: body.llmConfig.model,
			systemPrompt: SYSTEM_PROMPT,
			userPrompt: transcript,
			signal: controller.signal,
			apiKey: body.llmConfig.apiKey
		});
		const parsed = JSON.parse(content) as { summary?: string };
		if (!parsed.summary?.trim()) {
			return json({ error: 'LLM returned an empty summary' }, { status: 502 });
		}
		return json({ summary: parsed.summary.trim() });
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : 'Summarization failed' },
			{ status: 502 }
		);
	} finally {
		clearTimeout(timeout);
	}
};
