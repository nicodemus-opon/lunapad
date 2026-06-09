import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertSafe } from '$lib/server/project';
import { updateModelSchema } from '$lib/server/dbt-schema';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder, modelPath, updates } = (await request.json()) as {
			folder?: string;
			modelPath?: string;
			updates?: {
				description?: string | null;
				columns?: { name: string; description?: string; tests?: string[] }[];
				config?: { materialized?: string; schema?: string | null; tags?: string[] };
			};
		};

		if (!folder || !modelPath || !updates) {
			return json({ error: 'folder, modelPath, and updates are required' }, { status: 400 });
		}

		// Security: ensure modelPath resolves within the project folder
		const { join } = await import('node:path');
		const fullPath = join(folder, modelPath);
		assertSafe(folder, fullPath);

		// Normalize null → undefined for config.schema (null means "remove override")
		const normalizedUpdates = {
			...updates,
			config: updates.config ? {
				...updates.config,
				schema: updates.config.schema ?? undefined
			} : undefined
		};
		await updateModelSchema(folder, modelPath, normalizedUpdates);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
