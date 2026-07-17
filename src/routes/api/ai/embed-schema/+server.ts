import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { inngest } from '$lib/inngest/client';
import { ensureEmbeddingTables, deleteStaleSchemaEmbeddings } from '$lib/server/embeddings.js';
import { loadManifest } from '$lib/server/dbt.js';
import { assertSafe } from '$lib/server/project.js';
import { assertTenantProjectFolder } from '$lib/server/project-folders.js';

interface IncomingTable {
	tableName: string;
	columnNames: string;
	columnTypes: string;
	description?: string;
}

interface EmbedSchemaPayload {
	connectionId: string;
	tables: IncomingTable[];
	/** Open dbt project folder, if any — used to overlay richer dbt model/column descriptions. */
	projectFolder?: string | null;
}

// Large connections are chunked so no single Inngest step has to process thousands of
// sequential Ollama embedding calls, and so a transient failure only has to retry one chunk.
const CHUNK_SIZE = 300;

function bareTableName(tableName: string): string {
	const idx = tableName.lastIndexOf('.');
	return idx === -1 ? tableName : tableName.slice(idx + 1);
}

/** Overlays dbt model/column descriptions onto incoming tables, matched by bare table name
 *  (dbt model name == deployed table name, the convention this codebase already relies on
 *  elsewhere). dbt descriptions are curated by the team and take precedence over whatever
 *  warehouse-native comment (Postgres/ClickHouse, fetched client-side) may already be set. */
async function overlayDbtDescriptions(
	tables: IncomingTable[],
	projectFolder: string | null | undefined,
	locals: App.Locals
): Promise<IncomingTable[]> {
	if (!projectFolder) return tables;
	try {
		const folder = assertTenantProjectFolder(locals, projectFolder);
		assertSafe(folder, folder);
		const models = await loadManifest(folder);
		if (models.length === 0) return tables;

		const byName = new Map(models.map((m) => [m.name, m]));
		return tables.map((t) => {
			const model = byName.get(bareTableName(t.tableName));
			if (!model?.description) return t;
			return { ...t, description: model.description };
		});
	} catch {
		// Best-effort only — an unreadable/invalid project must never break embedding.
		return tables;
	}
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
	return chunks;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: EmbedSchemaPayload;
	try {
		body = (await request.json()) as EmbedSchemaPayload;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.connectionId || !Array.isArray(body.tables) || body.tables.length === 0) {
		return json({ error: 'connectionId and tables required' }, { status: 400 });
	}

	const enriched = await overlayDbtDescriptions(body.tables, body.projectFolder, locals);

	try {
		await ensureEmbeddingTables();
		// Synchronous, full-list cleanup — must happen here (not inside a chunked Inngest job)
		// since any single chunk only ever sees a subset of the connection's tables.
		const tenant = locals?.organization
			? { orgId: locals.organization.id, projectId: locals.project?.id }
			: undefined;
		if (tenant) {
			await deleteStaleSchemaEmbeddings(
				body.connectionId,
				enriched.map((t) => t.tableName),
				tenant
			);
		} else {
			await deleteStaleSchemaEmbeddings(
				body.connectionId,
				enriched.map((t) => t.tableName)
			);
		}

		for (const tablesChunk of chunk(enriched, CHUNK_SIZE)) {
			await inngest.send({
				name: 'ai/embed-schema',
				data: {
					orgId: tenant?.orgId,
					projectId: tenant?.projectId,
					connectionId: body.connectionId,
					tables: tablesChunk
				}
			});
		}
	} catch (err) {
		// Inngest/Postgres are optional — log the failure but don't surface it to the client.
		console.error('[embed-schema] dispatch failed:', err);
	}

	return json({ ok: true });
};
