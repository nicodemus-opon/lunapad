import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarizeOlderTurns } from './history-summarizer';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('summarizeOlderTurns', () => {
	const llmConfig = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma3:4b' };

	it('posts the messages and llmConfig and returns the summary', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ summary: 'Built a staging model for orders.' })
		});
		vi.stubGlobal('fetch', fetchMock);

		const messages = [{ role: 'user' as const, content: 'build a staging model' }];
		const summary = await summarizeOlderTurns(messages, llmConfig);

		expect(summary).toBe('Built a staging model for orders.');
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/ai/summarize-history',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ messages, llmConfig })
			})
		);
	});

	it('throws when the server returns an error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'LLM unreachable' }) })
		);
		await expect(summarizeOlderTurns([{ role: 'user', content: 'x' }], llmConfig)).rejects.toThrow(
			'LLM unreachable'
		);
	});

	it('throws when the response has no summary even if ok', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
		await expect(
			summarizeOlderTurns([{ role: 'user', content: 'x' }], llmConfig)
		).rejects.toThrow();
	});
});
