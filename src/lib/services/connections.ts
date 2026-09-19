import type { Connection, ConnectionSecret } from '$lib/types/connection';

interface QueryConnectionRequest {
	connection: Connection;
	sql: string;
	runId?: string;
}

interface QueryConnectionResponse {
	rows: Record<string, unknown>[];
	columns: string[];
}

export type ExternalMaterializationMode = 'table' | 'view' | 'incremental';
export type ExternalRelationType = 'table' | 'view';

interface MaterializeConnectionRequest {
	connection: Connection;
	targetName: string;
	targetSchema?: string;
	sql: string;
	mode: ExternalMaterializationMode;
}

interface MaterializeConnectionResponse {
	name: string;
	type: ExternalRelationType;
}

interface UploadConnectionRequest {
	connection: Connection;
	tableName: string;
	schema?: string;
	columns: { name: string; type: string }[];
	rows: unknown[][];
	mode: 'replace' | 'append';
}

interface UploadConnectionResponse {
	ok: boolean;
	rowsInserted?: number;
	error?: string;
}

async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(body),
		signal
	});

	if (!response.ok) {
		let message = `Request failed with ${response.status}`;
		try {
			const payload = (await response.json()) as { error?: string };
			message = payload.error || message;
		} catch {
			// Ignore JSON parse failures and keep the status-derived message.
		}
		throw new Error(message);
	}

	return (await response.json()) as T;
}

export async function queryConnectionSQL(
	connection: Connection,
	sql: string,
	signal?: AbortSignal,
	runId?: string
): Promise<QueryConnectionResponse> {
	const response = await fetch('/api/connections/query', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			connection,
			sql,
			runId
		} satisfies QueryConnectionRequest),
		signal
	});

	// Cloud queue deployments answer 202 with a job descriptor instead of rows —
	// poll the job until it reaches a terminal state, then unwrap its result.
	// Without this every interactive query on queue mode fails downstream with a
	// generic "unexpected response" error.
	if (response.status === 202) {
		const queued = (await response.json().catch(() => ({}))) as {
			job?: { id?: string };
		};
		const jobId = queued.job?.id;
		if (!jobId) {
			throw new Error(
				'Query was queued for background execution but no job id was returned. Check the Jobs panel.'
			);
		}
		return pollQueuedQueryResult(jobId, signal);
	}

	if (!response.ok) {
		let message = `Request failed with ${response.status}`;
		try {
			const payload = (await response.json()) as { error?: string };
			message = payload.error || message;
		} catch {
			// Ignore JSON parse failures and keep the status-derived message.
		}
		throw new Error(message);
	}

	return (await response.json()) as QueryConnectionResponse;
}

type QueuedQueryJob = {
	id: string;
	status: string;
	result?: unknown | null;
	error?: string | null;
};

function isAbortError(err: unknown): boolean {
	return (
		err instanceof Error &&
		(err.name === 'AbortError' || /aborted|abortion/i.test(err.message ?? ''))
	);
}

function throwAborted(): never {
	const err = new Error('Query cancelled');
	err.name = 'AbortError';
	throw err;
}

async function pollQueuedQueryResult(
	jobId: string,
	signal?: AbortSignal,
	timeoutMs = 120_000
): Promise<QueryConnectionResponse> {
	const start = Date.now();
	// Slightly faster than the smoke script's 750ms since interactive cells wait on this.
	const pollMs = 700;
	while (true) {
		if (signal?.aborted) {
			// Best-effort: release the queued/running job server-side, then settle
			// as a cancellation so the cell returns to idle instead of erroring.
			await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
				method: 'POST'
			}).catch(() => {});
			throwAborted();
		}
		let job: QueuedQueryJob;
		try {
			const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { signal });
			const body = (await res.json().catch(() => ({}))) as { job?: QueuedQueryJob };
			if (!res.ok || !body.job) {
				throw new Error(`Query job lookup failed (HTTP ${res.status}).`);
			}
			job = body.job;
		} catch (err) {
			if (signal?.aborted || isAbortError(err)) throwAborted();
			throw err;
		}
		switch (job.status) {
			case 'succeeded': {
				const result = job.result as Partial<QueryConnectionResponse> | null;
				if (!result || !Array.isArray(result.rows) || !Array.isArray(result.columns)) {
					throw new Error(
						'Query job succeeded but returned an unexpected result shape. Check the Jobs panel for details.'
					);
				}
				return { rows: result.rows, columns: result.columns };
			}
			case 'failed':
			case 'timed_out':
			case 'cancelled':
				throw new Error(job.error ?? `Query job ${job.status}.`);
			case 'queued':
			case 'running':
				break;
			default:
				throw new Error(`Query job has unknown status "${job.status}".`);
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error(
				'Query is still queued after 120s — the worker may be down. Check the Jobs panel and worker logs.'
			);
		}
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					signal?.removeEventListener('abort', onAbort);
					resolve();
				}, pollMs);
				const onAbort = () => {
					clearTimeout(timer);
					const err = new Error('Query cancelled');
					err.name = 'AbortError';
					reject(err);
				};
				if (signal?.aborted) {
					onAbort();
					return;
				}
				signal?.addEventListener('abort', onAbort, { once: true });
			});
		} catch (err) {
			if (isAbortError(err)) throwAborted();
			throw err;
		}
	}
}

export async function cancelConnectionQuery(runId: string): Promise<void> {
	await fetch('/api/connections/cancel', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ runId })
	}).catch(() => {});
}

export async function testConnection(
	connection: Connection,
	secret?: ConnectionSecret
): Promise<{ ok: boolean }> {
	return postJSON<{ ok: boolean }>('/api/connections/test', {
		connection,
		secret
	});
}

export async function fetchConnectionSchema(connection: Connection): Promise<{
	tables: Array<{ name: string; schema?: string; columns: string[]; columnTypes: string[] }>;
}> {
	return postJSON<{
		tables: Array<{ name: string; schema?: string; columns: string[]; columnTypes: string[] }>;
	}>('/api/connections/schema', {
		connection
	});
}

export async function removeConnectionSource(connection: Connection): Promise<void> {
	await fetch('/api/connections/remove', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ connection })
	}).catch(() => {});
}

// Syncs connection metadata (host/port/catalog/etc — never secrets) server-side so the
// public API and MCP server have a source of truth independent of any browser tab's
// localStorage. Best-effort: a transient failure here shouldn't block local editing.
export async function syncConnectionMetadata(connection: Connection): Promise<void> {
	await fetch('/api/connections/sync', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ connection })
	}).catch(() => {});
}

export async function materializeConnectionRelation(
	connection: Connection,
	targetName: string,
	sql: string,
	mode: ExternalMaterializationMode,
	targetSchema?: string
): Promise<MaterializeConnectionResponse> {
	return postJSON<MaterializeConnectionResponse>('/api/connections/materialize', {
		connection,
		targetName,
		targetSchema,
		sql,
		mode
	} satisfies MaterializeConnectionRequest);
}

export async function uploadConnectionTable(
	connection: Connection,
	tableName: string,
	columns: { name: string; type: string }[],
	rows: unknown[][],
	mode: 'replace' | 'append' = 'replace',
	schema?: string
): Promise<{ rowsInserted: number }> {
	const result = await postJSON<UploadConnectionResponse>('/api/connections/upload', {
		connection,
		tableName,
		schema,
		columns,
		rows,
		mode
	} satisfies UploadConnectionRequest);
	if (!result.ok) throw new Error(result.error ?? 'Upload failed');
	return { rowsInserted: result.rowsInserted ?? 0 };
}
