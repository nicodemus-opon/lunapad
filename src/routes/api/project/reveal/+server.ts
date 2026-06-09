import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'node:child_process';
import os from 'node:os';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { path: targetPath } = (await request.json()) as { path?: string };
		if (!targetPath) return json({ error: 'path is required' }, { status: 400 });

		const cmd = os.platform() === 'darwin' ? 'open' : os.platform() === 'win32' ? 'explorer' : 'xdg-open';
		spawn(cmd, [targetPath], { detached: true, stdio: 'ignore' }).unref();
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
