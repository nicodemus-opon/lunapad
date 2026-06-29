import { inngest } from '../client';
import { upsertSchemaEmbedding, ensureEmbeddingTables } from '$lib/server/embeddings.js';

export interface EmbedSchemaEventData {
	connectionId: string;
	tables: Array<{
		tableName: string;
		columnNames: string;
		columnTypes: string;
		description?: string;
	}>;
}

// Upsert-only — stale-row cleanup (deleting embeddings for tables no longer in the connection's
// schema) happens synchronously in the /api/ai/embed-schema endpoint against the *full* table
// list before chunking, not here. A single chunk only ever sees a subset of a connection's
// tables, so deleting "anything not in this chunk" here would wrongly delete tables that are
// simply scheduled in a later chunk.
export const embedSchemaFunction = inngest.createFunction(
	{
		id: 'embed-schema',
		retries: 1,
		triggers: [{ event: 'ai/embed-schema' }],
		// Rate-limit to avoid hammering Ollama
		rateLimit: { limit: 5, period: '1s' }
	},
	async ({ event, step }) => {
		const { connectionId, tables } = event.data as EmbedSchemaEventData;

		return step.run('embed', async () => {
			await ensureEmbeddingTables();
			let embedded = 0;
			for (const t of tables) {
				await upsertSchemaEmbedding({
					connectionId,
					tableName: t.tableName,
					columnNames: t.columnNames,
					columnTypes: t.columnTypes,
					description: t.description
				});
				embedded++;
			}
			return { embedded };
		});
	}
);
