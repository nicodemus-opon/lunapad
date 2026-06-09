import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafe } from '$lib/server/project';
import { readSchemaFile, findSchemaFile, upsertModelEntry, writeSchemaFile } from '$lib/server/dbt-schema';
import { compileSingleModel, collectProjectModelNames } from '$lib/server/prql-compiler';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder, file, content, isDbtProject } = (await request.json()) as {
			folder?: string;
			file?: string;
			content?: string;
			isDbtProject?: boolean;
		};
		if (!folder || !file || typeof content !== 'string') {
			return json({ error: 'folder, file, and content are required' }, { status: 400 });
		}

		const filePath = path.join(folder, file);
		assertSafe(folder, filePath);

		const isNew = await fs.access(filePath).then(() => false).catch(() => true);

		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, content, 'utf-8');

		if (isDbtProject && file.endsWith('.prql')) {
			// Auto-stub a yml entry for new files
			if (isNew) {
				const modelName = path.basename(file, '.prql');
				const ymlPath = findSchemaFile(folder, file);
				const schema = await readSchemaFile(ymlPath);
				if (!schema.models.find((m) => m.name === modelName)) {
					const updated = upsertModelEntry(schema, modelName, { description: '' });
					await writeSchemaFile(ymlPath, updated);
				}
			}

			// Compile to companion .sql immediately so the file tree stays consistent
			try {
				const knownModels = await collectProjectModelNames(folder);
				await compileSingleModel(filePath, folder, knownModels);
			} catch { /* best-effort — dbt compile will catch real errors */ }
		}

		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
