import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeProjectFile } from '$lib/server/project';

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

		await writeProjectFile(folder, file, content, { isDbtProject });

		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
