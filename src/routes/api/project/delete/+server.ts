import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertSafe, deleteCellFile } from '$lib/server/project';
import { findSchemaFile, readSchemaFile, removeModelEntry, writeSchemaFile } from '$lib/server/dbt-schema';
import path from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder, file } = (await request.json()) as { folder?: string; file?: string };
		if (!folder || !file) return json({ error: 'folder and file are required' }, { status: 400 });

		const filePath = path.join(folder, file);
		assertSafe(folder, filePath);

		await deleteCellFile(filePath);

		// Remove the model's _models.yml entry so it doesn't become a dangling reference
		if (file.endsWith('.prql')) {
			const modelName = path.basename(file, '.prql');
			const ymlPath = findSchemaFile(folder, file);
			const schema = await readSchemaFile(ymlPath);
			if (schema.models.some((m) => m.name === modelName)) {
				await writeSchemaFile(ymlPath, removeModelEntry(schema, modelName));
			}
		}

		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
