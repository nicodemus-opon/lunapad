import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { getGitDiff } from '$lib/server/git-runner';
import { assertSafe } from '$lib/server/project';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		const filePath = url.searchParams.get('path');
		const staged = url.searchParams.get('staged') === '1';
		const untracked = url.searchParams.get('untracked') === '1';
		if (!requestedFolder || !filePath)
			return json({ error: 'folder and path are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		if (untracked) {
			// Untracked files have nothing in the index to diff against. Rather than
			// lean on `git diff --no-index`'s "exit 1 means differences found" quirk,
			// just render the whole file as additions directly from disk.
			const target = path.join(folder, filePath);
			assertSafe(folder, target);
			const content = await fs.readFile(target, 'utf-8');
			const lines = content.split('\n');
			const body = lines.map((line) => `+${line}`).join('\n');
			const diff = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
			return json({ diff });
		}

		const diff = await getGitDiff(folder, filePath, staged);
		return json({ diff });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
