import { inngest } from '../client';
import { upsertMemoryEmbedding, ensureEmbeddingTables } from '$lib/server/embeddings.js';

export interface EmbedMemoryEventData {
	folder: string;
	slug: string;
	type: string;
	description: string;
}

export const embedMemoryFunction = inngest.createFunction(
	{
		id: 'embed-memory',
		retries: 1,
		triggers: [{ event: 'ai/embed-memory' }],
		// Rate-limit to avoid hammering Ollama
		rateLimit: { limit: 5, period: '1s' }
	},
	async ({ event, step }) => {
		const { folder, slug, type, description } = event.data as EmbedMemoryEventData;

		return step.run('embed', async () => {
			await ensureEmbeddingTables();
			await upsertMemoryEmbedding({ folder, slug, type, description });
			return { embedded: 1 };
		});
	}
);
