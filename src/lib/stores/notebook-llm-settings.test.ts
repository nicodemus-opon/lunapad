import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recordCellExecutionMetadataMock, recordUploadedTableMetadataMock } = vi.hoisted(() => ({
	recordCellExecutionMetadataMock: vi.fn(),
	recordUploadedTableMetadataMock: vi.fn()
}));

vi.mock('$lib/services/intelligence-db', () => ({
	recordCellExecutionMetadata: recordCellExecutionMetadataMock,
	recordUploadedTableMetadata: recordUploadedTableMetadataMock,
	getIntelligentQuickChips: vi.fn().mockResolvedValue([])
}));

import {
	__resetStateForTests,
	exportJSON,
	getLLMConfig,
	importJSON,
	initWorkspaceMode,
	loadUserLlmSettings,
	saveUserLlmSettings,
	setLLMConfig
} from '$lib/stores/notebook.svelte';

describe('notebook LLM settings persistence', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		__resetStateForTests();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('excludes llmConfig from workspace export in server workspace mode', () => {
		initWorkspaceMode(false);
		setLLMConfig({
			provider: 'openapi-compatible',
			baseUrl: 'https://api.example.com/v1',
			model: 'gpt-4o',
			apiKey: 'secret-key'
		});

		const exported = JSON.parse(exportJSON());
		expect(exported.llmConfig).toBeUndefined();
	});

	it('includes non-secret llmConfig in workspace export for local/demo mode', () => {
		initWorkspaceMode(true);
		setLLMConfig({
			provider: 'openapi-compatible',
			baseUrl: 'https://api.example.com/v1',
			model: 'gpt-4o',
			completionModel: 'gpt-4o-mini'
		});

		const exported = JSON.parse(exportJSON());
		expect(exported.llmConfig).toEqual({
			provider: 'openapi-compatible',
			baseUrl: 'https://api.example.com/v1',
			model: 'gpt-4o',
			completionModel: 'gpt-4o-mini'
		});
		expect(exported.llmConfig.apiKey).toBeUndefined();
	});

	it('debounces PATCH to /api/account/settings when setLLMConfig runs in server mode', async () => {
		initWorkspaceMode(false);
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ settings: {} }), { status: 200 }));

		setLLMConfig({ apiKey: 'sk-test', model: 'gpt-4o' });
		expect(fetchMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(500);

		expect(fetchMock).toHaveBeenCalledWith('/api/account/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				settings: {
					llmConfig: {
						provider: 'ollama',
						baseUrl: 'http://127.0.0.1:11434',
						model: 'gpt-4o',
						apiKey: 'sk-test'
					}
				}
			})
		});
	});

	it('does not PATCH user settings in local/demo mode', async () => {
		initWorkspaceMode(true);
		const fetchMock = vi.mocked(fetch);

		setLLMConfig({ model: 'local-model' });
		await vi.advanceTimersByTimeAsync(500);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('loadUserLlmSettings merges server settings including apiKey and completionModel', async () => {
		initWorkspaceMode(false);
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					settings: {
						llmConfig: {
							provider: 'openapi-compatible',
							baseUrl: 'https://api.example.com/v1',
							model: 'gpt-4o',
							apiKey: 'server-key',
							completionModel: 'gpt-4o-mini'
						}
					}
				}),
				{ status: 200 }
			)
		);

		await loadUserLlmSettings();

		expect(getLLMConfig()).toMatchObject({
			provider: 'openapi-compatible',
			baseUrl: 'https://api.example.com/v1',
			model: 'gpt-4o',
			apiKey: 'server-key',
			completionModel: 'gpt-4o-mini'
		});
	});

	it('migrates legacy workspace llmConfig into user_settings when server settings are empty', async () => {
		initWorkspaceMode(false);
		const fetchMock = vi.mocked(fetch);
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify({ settings: {} }), { status: 200 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ settings: { llmConfig: { model: 'legacy-model' } } }), {
					status: 200
				})
			);

		await loadUserLlmSettings({
			provider: 'openapi-compatible',
			baseUrl: 'https://legacy.example.com/v1',
			model: 'legacy-model',
			apiKey: 'legacy-key'
		});

		expect(getLLMConfig()).toMatchObject({
			provider: 'openapi-compatible',
			baseUrl: 'https://legacy.example.com/v1',
			model: 'legacy-model',
			apiKey: 'legacy-key'
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenLastCalledWith('/api/account/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				settings: {
					llmConfig: {
						provider: 'openapi-compatible',
						baseUrl: 'https://legacy.example.com/v1',
						model: 'legacy-model',
						apiKey: 'legacy-key'
					}
				}
			})
		});
	});

	it('importJSON restores llmConfig from workspace blob in local mode only', () => {
		initWorkspaceMode(true);
		importJSON(
			JSON.stringify({
				notebooks: [],
				llmConfig: {
					provider: 'openapi-compatible',
					baseUrl: 'https://blob.example.com/v1',
					model: 'blob-model',
					completionModel: 'blob-completion'
				}
			})
		);

		expect(getLLMConfig()).toMatchObject({
			provider: 'openapi-compatible',
			baseUrl: 'https://blob.example.com/v1',
			model: 'blob-model',
			completionModel: 'blob-completion'
		});
	});

	it('importJSON ignores workspace llmConfig in server mode', () => {
		initWorkspaceMode(false);
		importJSON(
			JSON.stringify({
				notebooks: [],
				llmConfig: {
					provider: 'openapi-compatible',
					baseUrl: 'https://blob.example.com/v1',
					model: 'blob-model',
					apiKey: 'blob-key'
				}
			})
		);

		expect(getLLMConfig()).toMatchObject({
			provider: 'ollama',
			baseUrl: 'http://127.0.0.1:11434',
			model: 'qwen3:4b'
		});
		expect(getLLMConfig().apiKey).toBeUndefined();
	});

	it('saveUserLlmSettings sends the full in-memory llmConfig', async () => {
		initWorkspaceMode(false);
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ settings: {} }), { status: 200 }));

		setLLMConfig({
			provider: 'openapi-compatible',
			baseUrl: 'https://api.example.com/v1',
			model: 'gpt-4o',
			apiKey: 'direct-save',
			completionModel: 'gpt-4o-mini'
		});

		await saveUserLlmSettings();

		expect(fetchMock).toHaveBeenCalledWith('/api/account/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				settings: {
					llmConfig: {
						provider: 'openapi-compatible',
						baseUrl: 'https://api.example.com/v1',
						model: 'gpt-4o',
						apiKey: 'direct-save',
						completionModel: 'gpt-4o-mini'
					}
				}
			})
		});
	});
});
