import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	spawnPythonCell,
	ensureProjectPinnedPackages,
	type PythonTable,
	type PythonTableDescriptor
} from '$lib/server/python-runner';
import { readPinnedPackages } from '$lib/server/python-packages';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { code, tables, tableDescriptors, notebookId, folder } = (await request.json()) as {
			code?: string;
			tables?: Record<string, PythonTable>;
			tableDescriptors?: PythonTableDescriptor[];
			notebookId?: string;
			folder?: string;
		};
		if (typeof code !== 'string') return json({ error: 'code is required' }, { status: 400 });
		if (typeof notebookId !== 'string')
			return json({ error: 'notebookId is required' }, { status: 400 });

		if (folder) {
			// One-time (per server process, per project) sync of any extras a
			// teammate already pinned for this project — cheap no-op on every
			// run after the first thanks to ensureProjectPinnedPackages' cache.
			const pins = await readPinnedPackages(folder);
			await ensureProjectPinnedPackages(folder, pins);
		}

		const jobId = spawnPythonCell(notebookId, code, tables ?? {}, tableDescriptors ?? []);
		return json({ jobId });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
