import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertSafe } from '$lib/server/project';
import { auditAndFixProjectYmls } from '$lib/server/project';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder } = (await request.json()) as { folder?: string };
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });
		assertSafe(folder, folder);
		const result = await auditAndFixProjectYmls(folder);
		return json(result);
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
