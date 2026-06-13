import { inngest } from '../client';
import { upsertCellEmbedding, ensureEmbeddingTables } from '$lib/server/embeddings.js';

export interface EmbedCellsEventData {
	cells: Array<{
		notebookId: string;
		cellId: string;
		outputName: string;
		code: string;
	}>;
}

export const embedCellsFunction = inngest.createFunction(
	{
		id: 'embed-cells',
		retries: 1,
		triggers: [{ event: 'ai/embed-cells' }],
		// Rate-limit to avoid hammering Ollama
		rateLimit: { limit: 5, period: '1s' }
	},
	async ({ event, step }) => {
		const { cells } = event.data as EmbedCellsEventData;

		return step.run('embed', async () => {
			await ensureEmbeddingTables();
			let embedded = 0;
			for (const cell of cells) {
				await upsertCellEmbedding(cell);
				embedded++;
			}
			return { embedded };
		});
	}
);
