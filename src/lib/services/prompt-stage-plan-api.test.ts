import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../routes/api/llm/prompt-stage-plan/+server';

function makeRequest(body: unknown): Request {
	return new Request('http://localhost/api/llm/prompt-stage-plan', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/llm/prompt-stage-plan', () => {
	it('sends non-rigid generation parameters and richer planning instructions', async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: JSON.stringify({
								label: 'Top Revenue by Region',
								prompt: 'Top revenue by region',
								reasons: ['Uses revenue and region to rank top segments'],
								score: 142,
								confidence: 0.82,
								stages: [
									{ type: 'group', by: ['region'], aggregations: [{ name: 'total_revenue', column: 'revenue', func: 'sum' }] },
									{ type: 'sort', keys: [{ column: 'total_revenue', dir: 'desc' }] },
									{ type: 'take', n: 5 }
								]
							})
						}
					}
				]
			})
		}));

		vi.stubGlobal('fetch', fetchMock);

		const response = await POST({
			request: makeRequest({
				query: 'show top regions by revenue',
				availableColumns: ['region', 'revenue', 'created_at'],
				llmContext: {
					sourceTable: 'since23',
					pipelineStageTypes: ['from'],
					columns: [
						{
							name: 'region',
							dataKind: 'text',
							semanticType: 'region',
							semanticConfidence: 0.9,
							nullRatio: 0,
							distinctCount: 12,
							sampleValues: ['west', 'east']
						}
					]
				},
				llmConfig: { provider: 'openapi-compatible', baseUrl: 'http://127.0.0.1:11434', model: 'test-model' }
			})
		} as never);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(calledUrl).toBe('http://127.0.0.1:11434/v1/chat/completions');

		const payload = JSON.parse(String(init.body)) as {
			temperature: number;
			top_p: number;
			frequency_penalty: number;
			presence_penalty: number;
			messages: Array<{ role: string; content: string }>;
		};

		expect(payload.temperature).toBe(0.2);
		expect(payload.top_p).toBe(0.9);
		expect(payload.frequency_penalty).toBe(0.1);
		expect(payload.presence_penalty).toBe(0.0);
		expect(payload.messages[0]?.content).toContain('Produce concrete, non-generic labels and reasons');
		expect(payload.messages[1]?.content).toContain('avoid generic wording');
		expect(payload.messages[1]?.content).toContain('avoid lazy count-only plans');
		expect(payload.messages[1]?.content).toContain('schemaContext');
		expect(payload.messages[1]?.content).toContain('columnContext');
		expect(payload.messages[1]?.content).toContain('Few-shot intent translations');
	});

	it('replaces generic labels and reasons with query-aware fallbacks', async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: JSON.stringify({
								label: 'analysis',
								prompt: '',
								reasons: ['LLM-inferred stage chain'],
								stages: [{ type: 'take', n: 10 }]
							})
						}
					}
				]
			})
		}));

		vi.stubGlobal('fetch', fetchMock);

		const response = await POST({
			request: makeRequest({
				query: 'top countries by amount',
				availableColumns: ['country', 'amount'],
				llmConfig: { provider: 'openapi-compatible', baseUrl: 'http://localhost:9999/v1', model: 'test-model' }
			})
		} as never);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			suggestion: { label: string; prompt: string; reasons: string[] };
		};

		expect(body.suggestion.label).toContain('Plan: top countries by amount');
		expect(body.suggestion.prompt).toContain('top countries by amount');
		expect(body.suggestion.reasons[0]).toContain('top countries by amount');
		expect(body.suggestion.reasons[0]).toContain('country');
	});

	it('retries once with repair instructions when first plan fails validation', async () => {
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(async () => ({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: '{"broken": true'
							}
						}
					]
				})
			}))
			.mockImplementationOnce(async () => ({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
									label: 'Top payees in january',
									prompt: 'Filter january then rank payees by withdrawn',
									reasons: ['Uses Completion Time and Payee for january-specific ranking'],
									stages: [
										{ type: 'filter', conditions: [{ column: 'Completion Time', op: 'text.contains', value: '2026-01' }], logic: 'and' },
										{ type: 'group', by: ['Payee'], aggregations: [{ name: 'sum_Withdrawn', column: 'Withdrawn', func: 'sum' }] },
										{ type: 'sort', keys: [{ column: 'sum_Withdrawn', dir: 'desc' }] },
										{ type: 'take', n: 10 }
									],
									confidence: 0.84
								})
							}
						}
					]
				})
			}));

		vi.stubGlobal('fetch', fetchMock);

		const response = await POST({
			request: makeRequest({
				query: 'who did i pay the most in january',
				availableColumns: ['Completion Time', 'Payee', 'Withdrawn', 'Paid In'],
				llmConfig: { provider: 'openapi-compatible', baseUrl: 'http://localhost:9999/v1', model: 'test-model' }
			})
		} as never);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const secondPayload = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(secondPayload.messages[1]?.content).toContain('Repair instructions');
		expect(secondPayload.messages[1]?.content).toContain('unknown columns');
	});
});
