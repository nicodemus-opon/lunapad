import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryConnectionSQL } from './connections';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const conn = {
	id: 'pg-main',
	name: 'pg',
	type: 'postgres',
	catalogName: 'pg',
	host: 'h',
	port: 5432,
	database: 'd',
	username: 'u',
	ssl: false
} as never;

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	fetchMock.mockReset();
});

describe('queryConnectionSQL queue mode', () => {
	it('polls a 202 job until succeeded and returns rows', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(202, { job: { id: 'job-1' } }))
			.mockResolvedValueOnce(jsonResponse(200, { job: { id: 'job-1', status: 'running' } }))
			.mockResolvedValueOnce(
				jsonResponse(200, {
					job: {
						id: 'job-1',
						status: 'succeeded',
						result: { rows: [{ a: 1 }], columns: ['a'] }
					}
				})
			);
		const result = await queryConnectionSQL(conn, 'SELECT 1');
		expect(result).toEqual({ rows: [{ a: 1 }], columns: ['a'] });
		expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/jobs/job-1');
	});

	it('surfaces job failure verbatim', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(202, { job: { id: 'job-2' } }))
			.mockResolvedValueOnce(
				jsonResponse(200, { job: { id: 'job-2', status: 'failed', error: 'boomopos' } })
			);
		await expect(queryConnectionSQL(conn, 'SELECT 1')).rejects.toThrow('boomopos');
	});

	it('aborts polling with AbortError and cancels the job', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation(async (url: string) => {
			if (String(url).includes('/api/connections/query')) {
				return jsonResponse(202, { job: { id: 'job-3' } });
			}
			if (String(url).includes('/cancel')) return jsonResponse(200, { job: {} });
			controller.abort();
			return jsonResponse(200, { job: { id: 'job-3', status: 'running' } });
		});
		await expect(queryConnectionSQL(conn, 'SELECT 1', controller.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
	});
});
