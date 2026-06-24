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
	return postJSON<QueryConnectionResponse>(
		'/api/connections/query',
		{
			connection,
			sql,
			runId
		} satisfies QueryConnectionRequest,
		signal
	);
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

export async function fetchConnectionSchema(
	connection: Connection
): Promise<{
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
