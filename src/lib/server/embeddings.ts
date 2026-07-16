import crypto from 'node:crypto';
import { query } from './db.js';
import {
	DEFAULT_ORG_ID,
	DEFAULT_PROJECT_ID,
	ensureDefaultTenant,
	type TenantRef
} from './tenancy.js';

const EMBED_MODEL = 'nomic-embed-text';
const EMBED_DIM = 768;

export function getOllamaBaseUrl(): string {
	return (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
	try {
		const response = await fetch(`${getOllamaBaseUrl()}/api/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
		});
		if (!response.ok) return null;
		const body = (await response.json()) as { embedding: number[] };
		return body.embedding ?? null;
	} catch {
		return null;
	}
}

export async function ensureEmbeddingTables(): Promise<void> {
	try {
		await ensureDefaultTenant();
		await query(`CREATE EXTENSION IF NOT EXISTS vector`);
		await query(`
			CREATE TABLE IF NOT EXISTS cell_embeddings (
				id           SERIAL PRIMARY KEY,
				org_id       TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
				project_id   TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
				notebook_id  TEXT NOT NULL,
				cell_id      TEXT NOT NULL,
				output_name  TEXT NOT NULL,
				code_hash    TEXT NOT NULL,
				embedding    vector(${EMBED_DIM}),
				code_snippet TEXT,
				updated_at   TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE(project_id, notebook_id, cell_id)
			)
		`);
		await query(
			`ALTER TABLE cell_embeddings ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
		);
		await query(
			`ALTER TABLE cell_embeddings ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
		);
		await query(
			`ALTER TABLE cell_embeddings DROP CONSTRAINT IF EXISTS cell_embeddings_notebook_id_cell_id_key`
		);
		await query(
			`CREATE UNIQUE INDEX IF NOT EXISTS cell_embeddings_project_notebook_cell_idx
			 ON cell_embeddings (project_id, notebook_id, cell_id)`
		);
		await query(`
			CREATE INDEX IF NOT EXISTS cell_embeddings_hnsw_idx
			ON cell_embeddings USING hnsw (embedding vector_cosine_ops)
		`);
		await query(`
			CREATE TABLE IF NOT EXISTS schema_embeddings (
				id           SERIAL PRIMARY KEY,
				org_id       TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
				connection_id TEXT NOT NULL DEFAULT 'builtin',
				table_name   TEXT NOT NULL,
				column_names TEXT NOT NULL,
				embedding    vector(${EMBED_DIM}),
				updated_at   TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE(org_id, connection_id, table_name)
			)
		`);
		await query(
			`ALTER TABLE schema_embeddings ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
		);
		await query(
			`ALTER TABLE schema_embeddings DROP CONSTRAINT IF EXISTS schema_embeddings_connection_id_table_name_key`
		);
		await query(
			`CREATE UNIQUE INDEX IF NOT EXISTS schema_embeddings_org_connection_table_idx
			 ON schema_embeddings (org_id, connection_id, table_name)`
		);
		// Migration for tables created in the dead-code era (before content_hash/column_types
		// existed) — IF NOT EXISTS makes this a no-op on fresh installs.
		await query(`ALTER TABLE schema_embeddings ADD COLUMN IF NOT EXISTS content_hash TEXT`);
		await query(`ALTER TABLE schema_embeddings ADD COLUMN IF NOT EXISTS column_types TEXT`);
		await query(`
			CREATE INDEX IF NOT EXISTS schema_embeddings_hnsw_idx
			ON schema_embeddings USING hnsw (embedding vector_cosine_ops)
		`);
		await query(`
			CREATE TABLE IF NOT EXISTS memory_embeddings (
				id           SERIAL PRIMARY KEY,
				org_id       TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
				project_id   TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
				folder       TEXT NOT NULL,
				slug         TEXT NOT NULL,
				type         TEXT NOT NULL,
				embedding    vector(${EMBED_DIM}),
				description  TEXT,
				updated_at   TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE(project_id, folder, slug)
			)
		`);
		await query(
			`ALTER TABLE memory_embeddings ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
		);
		await query(
			`ALTER TABLE memory_embeddings ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
		);
		await query(
			`ALTER TABLE memory_embeddings DROP CONSTRAINT IF EXISTS memory_embeddings_folder_slug_key`
		);
		await query(
			`CREATE UNIQUE INDEX IF NOT EXISTS memory_embeddings_project_folder_slug_idx
			 ON memory_embeddings (project_id, folder, slug)`
		);
		await query(`
			CREATE INDEX IF NOT EXISTS memory_embeddings_hnsw_idx
			ON memory_embeddings USING hnsw (embedding vector_cosine_ops)
		`);
		await query(`
			CREATE TABLE IF NOT EXISTS workspace_patterns (
				id            SERIAL PRIMARY KEY,
				org_id        TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
				project_id    TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
				session_id    TEXT NOT NULL,
				cell_id       TEXT,
				output_name   TEXT,
				outcome       TEXT NOT NULL,
				original_code TEXT,
				final_code    TEXT,
				recorded_at   TIMESTAMPTZ DEFAULT NOW()
			)
		`);
		await query(
			`ALTER TABLE workspace_patterns ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
		);
		await query(
			`ALTER TABLE workspace_patterns ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
		);
	} catch {
		// Postgres not available — silently skip
	}
}

export async function upsertCellEmbedding(input: {
	tenant?: TenantRef | null;
	notebookId: string;
	cellId: string;
	outputName: string;
	code: string;
}): Promise<void> {
	const hash = crypto.createHash('sha256').update(input.code).digest('hex');

	const existing = await query<{ code_hash: string }>(
		`SELECT code_hash FROM cell_embeddings
		 WHERE notebook_id = $1 AND cell_id = $2 AND org_id = $3 AND project_id = $4`,
		[
			input.notebookId,
			input.cellId,
			input.tenant?.orgId ?? DEFAULT_ORG_ID,
			input.tenant?.projectId ?? DEFAULT_PROJECT_ID
		]
	).catch(() => []);

	if (existing[0]?.code_hash === hash) return;

	const text = `${input.outputName}\n${input.code.slice(0, 500)}`;
	const embedding = await generateEmbedding(text);
	if (!embedding) return;

	await query(
		`INSERT INTO cell_embeddings (org_id, project_id, notebook_id, cell_id, output_name, code_hash, embedding, code_snippet, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, NOW())
		 ON CONFLICT (project_id, notebook_id, cell_id) DO UPDATE SET
		   output_name  = EXCLUDED.output_name,
		   code_hash    = EXCLUDED.code_hash,
		   embedding    = EXCLUDED.embedding,
		   code_snippet = EXCLUDED.code_snippet,
		   updated_at   = NOW()`,
		[
			input.tenant?.orgId ?? DEFAULT_ORG_ID,
			input.tenant?.projectId ?? DEFAULT_PROJECT_ID,
			input.notebookId,
			input.cellId,
			input.outputName,
			hash,
			JSON.stringify(embedding),
			input.code.slice(0, 500)
		]
	).catch(() => {});
}

export async function upsertSchemaEmbedding(input: {
	tenant?: TenantRef | null;
	connectionId: string;
	tableName: string;
	columnNames: string;
	columnTypes: string;
	description?: string;
}): Promise<void> {
	const hash = crypto
		.createHash('sha256')
		.update(
			`${input.tableName}|${input.columnNames}|${input.columnTypes}|${input.description ?? ''}`
		)
		.digest('hex');

	const existing = await query<{ content_hash: string }>(
		`SELECT content_hash FROM schema_embeddings
		 WHERE connection_id = $1 AND table_name = $2 AND org_id = $3`,
		[input.connectionId, input.tableName, input.tenant?.orgId ?? DEFAULT_ORG_ID]
	).catch(() => []);

	if (existing[0]?.content_hash === hash) return;

	const text = `${input.tableName}${input.description ? ' — ' + input.description : ''} columns: ${input.columnNames}`;
	const embedding = await generateEmbedding(text);
	if (!embedding) return;

	await query(
		`INSERT INTO schema_embeddings (org_id, connection_id, table_name, column_names, column_types, content_hash, embedding, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::vector, NOW())
		 ON CONFLICT (org_id, connection_id, table_name) DO UPDATE SET
		   column_names = EXCLUDED.column_names,
		   column_types = EXCLUDED.column_types,
		   content_hash = EXCLUDED.content_hash,
		   embedding    = EXCLUDED.embedding,
		   updated_at   = NOW()`,
		[
			input.tenant?.orgId ?? DEFAULT_ORG_ID,
			input.connectionId,
			input.tableName,
			input.columnNames,
			input.columnTypes,
			hash,
			JSON.stringify(embedding)
		]
	).catch(() => {});
}

/** Deletes embedded rows for tables no longer present in the connection's current schema —
 *  mirrors the full-replace semantics `setExternalConnectionSchema` already uses client-side.
 *  Without this, tables dropped from the warehouse leave phantom rows that pollute retrieval. */
export async function deleteStaleSchemaEmbeddings(
	connectionId: string,
	keepTableNames: string[],
	tenant?: TenantRef | null
): Promise<void> {
	if (keepTableNames.length === 0) {
		await query(`DELETE FROM schema_embeddings WHERE connection_id = $1 AND org_id = $2`, [
			connectionId,
			tenant?.orgId ?? DEFAULT_ORG_ID
		]).catch(() => {});
		return;
	}
	await query(
		`DELETE FROM schema_embeddings
		 WHERE connection_id = $1 AND table_name <> ALL($2::text[]) AND org_id = $3`,
		[connectionId, keepTableNames, tenant?.orgId ?? DEFAULT_ORG_ID]
	).catch(() => {});
}

export async function searchCellEmbeddings(
	queryText: string,
	limit = 5,
	tenant?: TenantRef | null
): Promise<Array<{ output_name: string; code_snippet: string; similarity: number }>> {
	const embedding = await generateEmbedding(queryText);
	if (!embedding) return [];

	return query<{ output_name: string; code_snippet: string; similarity: number }>(
		`SELECT output_name, code_snippet,
		        1 - (embedding <=> $1::vector) AS similarity
		 FROM cell_embeddings
		 WHERE org_id = $2 AND project_id = $3
		 ORDER BY embedding <=> $1::vector
		 LIMIT $4`,
		[
			JSON.stringify(embedding),
			tenant?.orgId ?? DEFAULT_ORG_ID,
			tenant?.projectId ?? DEFAULT_PROJECT_ID,
			limit
		]
	).catch(() => []);
}

export interface SchemaEmbeddingMatch {
	table_name: string;
	column_names: string;
	column_types: string | null;
	similarity: number;
}

export async function searchSchemaEmbeddings(
	queryText: string,
	limit = 5,
	connectionIds?: string[],
	tenant?: TenantRef | null
): Promise<SchemaEmbeddingMatch[]> {
	const embedding = await generateEmbedding(queryText);
	if (!embedding) return [];

	if (connectionIds && connectionIds.length > 0) {
		return query<SchemaEmbeddingMatch>(
			`SELECT table_name, column_names, column_types,
			        1 - (embedding <=> $1::vector) AS similarity
			 FROM schema_embeddings
			 WHERE connection_id = ANY($2::text[]) AND org_id = $4
			 ORDER BY embedding <=> $1::vector
			 LIMIT $3`,
			[JSON.stringify(embedding), connectionIds, limit, tenant?.orgId ?? DEFAULT_ORG_ID]
		).catch(() => []);
	}

	return query<SchemaEmbeddingMatch>(
		`SELECT table_name, column_names, column_types,
		        1 - (embedding <=> $1::vector) AS similarity
		 FROM schema_embeddings
		 WHERE org_id = $3
		 ORDER BY embedding <=> $1::vector
		 LIMIT $2`,
		[JSON.stringify(embedding), limit, tenant?.orgId ?? DEFAULT_ORG_ID]
	).catch(() => []);
}

export async function upsertMemoryEmbedding(input: {
	tenant?: TenantRef | null;
	folder: string;
	slug: string;
	type: string;
	description: string;
}): Promise<void> {
	const embedding = await generateEmbedding(`${input.type}: ${input.description}`);
	if (!embedding) return;

	await query(
		`INSERT INTO memory_embeddings (org_id, project_id, folder, slug, type, embedding, description, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6::vector, $7, NOW())
		 ON CONFLICT (project_id, folder, slug) DO UPDATE SET
		   type        = EXCLUDED.type,
		   embedding   = EXCLUDED.embedding,
		   description = EXCLUDED.description,
		   updated_at  = NOW()`,
		[
			input.tenant?.orgId ?? DEFAULT_ORG_ID,
			input.tenant?.projectId ?? DEFAULT_PROJECT_ID,
			input.folder,
			input.slug,
			input.type,
			JSON.stringify(embedding),
			input.description
		]
	).catch(() => {});
}

export interface MemoryEmbeddingMatch {
	slug: string;
	description: string;
	type: string;
	similarity: number;
}

export async function searchMemoryEmbeddings(
	queryText: string,
	folder: string,
	limit = 5,
	tenant?: TenantRef | null
): Promise<MemoryEmbeddingMatch[]> {
	const embedding = await generateEmbedding(queryText);
	if (!embedding) return [];

	return query<MemoryEmbeddingMatch>(
		`SELECT slug, description, type,
		        1 - (embedding <=> $1::vector) AS similarity
		 FROM memory_embeddings
		 WHERE folder = $2 AND org_id = $4 AND project_id = $5
		 ORDER BY embedding <=> $1::vector
		 LIMIT $3`,
		[
			JSON.stringify(embedding),
			folder,
			limit,
			tenant?.orgId ?? DEFAULT_ORG_ID,
			tenant?.projectId ?? DEFAULT_PROJECT_ID
		]
	).catch(() => []);
}

export async function countSchemaEmbeddings(
	connectionIds: string[],
	tenant?: TenantRef | null
): Promise<number> {
	if (connectionIds.length === 0) return 0;
	const rows = await query<{ count: string }>(
		`SELECT COUNT(*) AS count
		 FROM schema_embeddings
		 WHERE connection_id = ANY($1::text[]) AND org_id = $2`,
		[connectionIds, tenant?.orgId ?? DEFAULT_ORG_ID]
	).catch(() => []);
	return Number(rows[0]?.count ?? 0);
}

export async function listSchemaEmbeddings(
	connectionIds: string[],
	tenant?: TenantRef | null
): Promise<Array<{ table_name: string; column_names: string; column_types: string | null }>> {
	if (connectionIds.length === 0) return [];
	return query<{ table_name: string; column_names: string; column_types: string | null }>(
		`SELECT table_name, column_names, column_types
		 FROM schema_embeddings
		 WHERE connection_id = ANY($1::text[]) AND org_id = $2`,
		[connectionIds, tenant?.orgId ?? DEFAULT_ORG_ID]
	).catch(() => []);
}
