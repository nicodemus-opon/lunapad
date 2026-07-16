import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafe } from '$lib/server/project';
import { parseCellFile } from '$lib/services/prql-file';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		const file = url.searchParams.get('file');
		if (!requestedFolder || !file) {
			return json({ error: 'folder and file are required' }, { status: 400 });
		}
		const folder = assertTenantProjectFolder(locals, requestedFolder);

		const filePath = path.join(folder, file);
		assertSafe(folder, filePath);

		const content = await fs.readFile(filePath, 'utf-8');
		const fileLanguage = file.endsWith('.sql') ? 'sql' : 'prql';
		const parsed = parseCellFile(content, fileLanguage as 'prql' | 'sql');
		return json({ raw: content, parsed });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
