import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertSafe, renameCellFile } from '$lib/server/project';
import { findSchemaFile, readSchemaFile, renameModelEntry, removeModelEntry, upsertModelEntry, writeSchemaFile } from '$lib/server/dbt-schema';
import path from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder, oldFile, newFile } = (await request.json()) as {
			folder?: string;
			oldFile?: string;
			newFile?: string;
		};
		if (!folder || !oldFile || !newFile) {
			return json({ error: 'folder, oldFile, and newFile are required' }, { status: 400 });
		}

		const oldPath = path.join(folder, oldFile);
		const newPath = path.join(folder, newFile);
		assertSafe(folder, oldPath);
		assertSafe(folder, newPath);

		await renameCellFile(oldPath, newPath);

		// Migrate the _models.yml entry so descriptions/config/columns follow the rename.
		if (oldFile.endsWith('.prql') && newFile.endsWith('.prql')) {
			const oldYml = findSchemaFile(folder, oldFile);
			const newYml = findSchemaFile(folder, newFile);
			const oldName = path.basename(oldFile, '.prql');
			const newName = path.basename(newFile, '.prql');

			if (oldYml === newYml) {
				// Same directory — rename in-place
				if (oldName !== newName) {
					const schema = await readSchemaFile(oldYml);
					await writeSchemaFile(oldYml, renameModelEntry(schema, oldName, newName));
				}
			} else {
				// Cross-directory move — remove from old YML, upsert into new YML
				const oldSchema = await readSchemaFile(oldYml);
				const entry = oldSchema.models.find((m) => m.name === oldName);
				if (entry) {
					await writeSchemaFile(oldYml, removeModelEntry(oldSchema, oldName));
				}
				const newSchema = await readSchemaFile(newYml);
				await writeSchemaFile(
					newYml,
					upsertModelEntry(newSchema, newName, {
						description: entry?.description ?? '',
						columns: entry?.columns,
						config: entry?.config
					})
				);
			}
		}

		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
