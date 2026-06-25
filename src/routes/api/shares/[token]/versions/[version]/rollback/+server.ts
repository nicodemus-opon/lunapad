import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rollbackShareToVersion } from '$lib/server/shared-reports';

export const POST: RequestHandler = async ({ params }) => {
	const version = Number(params.version);
	if (!Number.isInteger(version)) return json({ error: 'Invalid version.' }, { status: 400 });
	try {
		const share = await rollbackShareToVersion(params.token, version);
		return json({ token: share.token, currentVersion: share.currentVersion });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to roll back.';
		return json({ error: message }, { status: 400 });
	}
};
