import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('./db.js', () => ({ query: queryMock }));

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

import { hasPostgres, hasOllama, _resetCapabilityCacheForTests } from './ai-capabilities';

describe('hasPostgres', () => {
	beforeEach(() => {
		_resetCapabilityCacheForTests();
		queryMock.mockReset();
	});

	it('returns true when the query succeeds', async () => {
		queryMock.mockResolvedValue([{ '?column?': 1 }]);
		expect(await hasPostgres()).toBe(true);
	});

	it('returns false when the query throws', async () => {
		queryMock.mockRejectedValue(new Error('connection refused'));
		expect(await hasPostgres()).toBe(false);
	});

	it('caches the result and does not re-query within the TTL', async () => {
		queryMock.mockResolvedValue([{ '?column?': 1 }]);
		await hasPostgres();
		await hasPostgres();
		expect(queryMock).toHaveBeenCalledTimes(1);
	});
});

describe('hasOllama', () => {
	beforeEach(() => {
		_resetCapabilityCacheForTests();
		fetchMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('returns true when /api/tags responds ok', async () => {
		fetchMock.mockResolvedValue({ ok: true });
		expect(await hasOllama()).toBe(true);
	});

	it('returns false when the request fails', async () => {
		fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
		expect(await hasOllama()).toBe(false);
	});

	it('returns false when the response is not ok', async () => {
		fetchMock.mockResolvedValue({ ok: false });
		expect(await hasOllama()).toBe(false);
	});

	it('caches the result and does not re-fetch within the TTL', async () => {
		fetchMock.mockResolvedValue({ ok: true });
		await hasOllama();
		await hasOllama();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
