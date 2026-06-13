import crypto from 'node:crypto';
import { query } from './db.js';

const EMBED_MODEL = 'nomic-embed-text';
const EMBED_DIM = 768;

function getOllamaBaseUrl(): string {
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
		await query(`CREATE EXTENSION IF NOT EXISTS vector`);
		await query(`
			CREATE TABLE IF NOT EXISTS cell_embeddings (
				id           SERIAL PRIMARY KEY,
				notebook_id  TEXT NOT NULL,
				cell_id      TEXT NOT NULL,
				output_name  TEXT NOT NULL,
				code_hash    TEXT NOT NULL,
				embedding    vector(${EMBED_DIM}),
				code_snippet TEXT,
				updated_at   TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE(notebook_id, cell_id)
			)
		`);
		await query(`
			CREATE INDEX IF NOT EXISTS cell_embeddings_hnsw_idx
			ON cell_embeddings USING hnsw (embedding vector_cosine_ops)
		`);
		await query(`
			CREATE TABLE IF NOT EXISTS schema_embeddings (
				id           SERIAL PRIMARY KEY,
				connection_id TEXT NOT NULL DEFAULT 'builtin',
				table_name   TEXT NOT NULL,
				column_names TEXT NOT NULL,
				embedding    vector(${EMBED_DIM}),
				updated_at   TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE(connection_id, table_name)
			)
		`);
		await query(`
			CREATE INDEX IF NOT EXISTS schema_embeddings_hnsw_idx
			ON schema_embeddings USING hnsw (embedding vector_cosine_ops)
		`);
		await query(`
			CREATE TABLE IF NOT EXISTS workspace_patterns (
				id            SERIAL PRIMARY KEY,
				session_id    TEXT NOT NULL,
				cell_id       TEXT,
				output_name   TEXT,
				outcome       TEXT NOT NULL,
				original_code TEXT,
				final_code    TEXT,
				recorded_at   TIMESTAMPTZ DEFAULT NOW()
			)
		`);
	} catch {
		// Postgres not available — silently skip
	}
}

export async function upsertCellEmbedding(input: {
	notebookId: string;
	cellId: string;
	outputName: string;
	code: string;
}): Promise<void> {
	const hash = crypto.createHash('sha256').update(input.code).digest('hex');

	const existing = await query<{ code_hash: string }>(
		`SELECT code_hash FROM cell_embeddings WHERE notebook_id = $1 AND cell_id = $2`,
		[input.notebookId, input.cellId]
	).catch(() => []);

	if (existing[0]?.code_hash === hash) return;

	const text = `${input.outputName}\n${input.code.slice(0, 500)}`;
	const embedding = await generateEmbedding(text);
	if (!embedding) return;

	await query(
		`INSERT INTO cell_embeddings (notebook_id, cell_id, output_name, code_hash, embedding, code_snippet, updated_at)
		 VALUES ($1, $2, $3, $4, $5::vector, $6, NOW())
		 ON CONFLICT (notebook_id, cell_id) DO UPDATE SET
		   output_name  = EXCLUDED.output_name,
		   code_hash    = EXCLUDED.code_hash,
		   embedding    = EXCLUDED.embedding,
		   code_snippet = EXCLUDED.code_snippet,
		   updated_at   = NOW()`,
		[input.notebookId, input.cellId, input.outputName, hash, JSON.stringify(embedding), input.code.slice(0, 500)]
	).catch(() => {});
}

export async function upsertSchemaEmbedding(input: {
	connectionId: string;
	tableName: string;
	columnNames: string;
}): Promise<void> {
	const text = `${input.tableName} columns: ${input.columnNames}`;
	const embedding = await generateEmbedding(text);
	if (!embedding) return;

	await query(
		`INSERT INTO schema_embeddings (connection_id, table_name, column_names, embedding, updated_at)
		 VALUES ($1, $2, $3, $4::vector, NOW())
		 ON CONFLICT (connection_id, table_name) DO UPDATE SET
		   column_names = EXCLUDED.column_names,
		   embedding    = EXCLUDED.embedding,
		   updated_at   = NOW()`,
		[input.connectionId, input.tableName, input.columnNames, JSON.stringify(embedding)]
	).catch(() => {});
}

export async function searchCellEmbeddings(
	queryText: string,
	limit = 5
): Promise<Array<{ output_name: string; code_snippet: string; similarity: number }>> {
	const embedding = await generateEmbedding(queryText);
	if (!embedding) return [];

	return query<{ output_name: string; code_snippet: string; similarity: number }>(
		`SELECT output_name, code_snippet,
		        1 - (embedding <=> $1::vector) AS similarity
		 FROM cell_embeddings
		 ORDER BY embedding <=> $1::vector
		 LIMIT $2`,
		[JSON.stringify(embedding), limit]
	).catch(() => []);
}

export async function searchSchemaEmbeddings(
	queryText: string,
	limit = 5
): Promise<Array<{ table_name: string; column_names: string; similarity: number }>> {
	const embedding = await generateEmbedding(queryText);
	if (!embedding) return [];

	return query<{ table_name: string; column_names: string; similarity: number }>(
		`SELECT table_name, column_names,
		        1 - (embedding <=> $1::vector) AS similarity
		 FROM schema_embeddings
		 ORDER BY embedding <=> $1::vector
		 LIMIT $2`,
		[JSON.stringify(embedding), limit]
	).catch(() => []);
}
