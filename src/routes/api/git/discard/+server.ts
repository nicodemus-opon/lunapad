import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { gitDiscardPaths } from '$lib/server/git-runner';
import { assertSafe } from '$lib/server/project';

/** Destructive: discards uncommitted changes to tracked files, deletes untracked ones.
 *  The client gates this behind a confirmation dialog before calling it. */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			folder: requestedFolder,
			paths,
			untracked
		} = (await request.json()) as {
			folder?: string;
			paths?: string[];
			untracked?: boolean;
		};
		if (!requestedFolder || !paths?.length)
			return json({ error: 'folder and paths are required' }, { status: 400 });
		const { folder } = resolveGitTenant(locals, requestedFolder);

		if (untracked) {
			for (const p of paths) {
				const target = path.join(folder, p);
				assertSafe(folder, target);
				await fs.rm(target, { force: true });
			}
			return json({ ok: true });
		}

		await gitDiscardPaths(folder, paths);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
