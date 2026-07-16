import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listShareVersions } from '$lib/server/shared-reports';
import { requireSharesRead } from '$lib/server/share-guards';

export const GET: RequestHandler = async ({ params, locals }) => {
	const denied = requireSharesRead(locals);
	if (denied) return json({ error: denied.error }, { status: denied.status });

	const versions = await listShareVersions(params.token, {
		orgId: locals.organization!.id,
		projectId: locals.project?.id
	});
	return json({ versions });
};
