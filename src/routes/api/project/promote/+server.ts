import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafe, buildQueryCellFromLuna, writeCellFile } from '$lib/server/project';
import {
	findSchemaFile,
	readSchemaFile,
	upsertModelEntry,
	writeSchemaFile
} from '$lib/server/dbt-schema';
import { compileSingleModel, collectProjectModelNames } from '$lib/server/prql-compiler';
import { replaceCellWithModelRef } from '$lib/services/luna-file';
import type { CellLanguage, CellMaterializationMode } from '$lib/stores/notebook.svelte';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

interface PromotePlanItem {
	outputName: string;
	code: string;
	language: CellLanguage;
	connectionId: string | null;
	/** Relative path under the project root, no extension, e.g. "models/staging/stg_orders". */
	targetRelPath: string;
	materialized: CellMaterializationMode;
	schema: string | null;
	tags: string[];
}

/**
 * Explodes one or more cells out of a `.luna` notebook into real dbt model
 * files, in the order given (ancestors before dependents, per the caller's
 * topological sort) so `{{ ref() }}` injection sees earlier writes as known
 * models. Best-effort: a failure on one item is reported but doesn't block
 * the rest. On success, the source `.luna` file is rewritten in place,
 * replacing each promoted cell's `{% query %}` block with a `{% model ref %}`
 * placeholder.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder, notebookFile, plan } = (await request.json()) as {
			folder?: string;
			notebookFile?: string;
			plan?: PromotePlanItem[];
		};
		if (!folder || !notebookFile || !plan?.length) {
			return json(
				{ error: 'folder, notebookFile, and a non-empty plan are required' },
				{ status: 400 }
			);
		}
		const resolvedFolder = assertTenantProjectFolder(locals, folder);

		const lunaPath = path.join(resolvedFolder, notebookFile);
		assertSafe(resolvedFolder, lunaPath);

		const promoted: Array<{ outputName: string; relPath: string }> = [];
		const errors: string[] = [];

		for (const item of plan) {
			try {
				const ext = item.language === 'sql' ? '.sql' : '.prql';
				const relPath = `${item.targetRelPath}${ext}`;
				const filePath = path.join(resolvedFolder, relPath);
				assertSafe(resolvedFolder, filePath);

				const cell = buildQueryCellFromLuna({
					kind: 'query',
					name: item.outputName,
					lang: item.language,
					connection: item.connectionId,
					materialized: item.materialized,
					schema: item.schema,
					tags: item.tags,
					meta: {},
					code: item.code
				});

				await writeCellFile(filePath, cell, await collectProjectModelNames(resolvedFolder));
				const compileErr = await compileSingleModel(
					filePath,
					resolvedFolder,
					await collectProjectModelNames(resolvedFolder)
				);
				if (compileErr) {
					errors.push(compileErr);
					continue;
				}

				const ymlPath = findSchemaFile(resolvedFolder, relPath);
				const schema = await readSchemaFile(ymlPath);
				if (!schema.models.find((m) => m.name === item.outputName)) {
					await writeSchemaFile(
						ymlPath,
						upsertModelEntry(schema, item.outputName, { description: '' })
					);
				}

				promoted.push({ outputName: item.outputName, relPath });
			} catch (err) {
				errors.push(`${item.outputName}: ${(err as Error).message}`);
			}
		}

		if (promoted.length > 0) {
			try {
				let content = await fs.readFile(lunaPath, 'utf-8');
				for (const { outputName } of promoted) {
					content = replaceCellWithModelRef(content, outputName);
				}
				await fs.writeFile(lunaPath, content, 'utf-8');
			} catch {
				// Best-effort — model files are already written; the .luna source will
				// keep showing the old query blocks until the next manual edit/reload.
			}
		}

		return json({ promoted, errors });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
