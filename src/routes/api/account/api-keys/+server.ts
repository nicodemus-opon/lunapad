import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApiKey, listApiKeys } from '$lib/server/api-keys';
import { ALL_API_SCOPES } from '$lib/server/permissions';

interface CreateApiKeyRequest {
	name: string;
	expiresInDays?: number;
	scopes?: string[];
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const keys = await listApiKeys(locals.user.id, locals.organization?.id);
	return json({ keys });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	try {
		const body = (await request.json()) as Partial<CreateApiKeyRequest>;
		const name = body.name?.trim();
		if (!name) return json({ error: 'A name is required.' }, { status: 400 });

		const expiresAt =
			typeof body.expiresInDays === 'number' && body.expiresInDays > 0
				? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
				: null;

		let scopes: string[] | null = null;
		if (body.scopes !== undefined) {
			if (!Array.isArray(body.scopes)) {
				return json({ error: 'scopes must be an array of strings.' }, { status: 400 });
			}
			const allowed = new Set<string>([...ALL_API_SCOPES, 'automation:full']);
			const unknown = body.scopes.filter((s) => !allowed.has(s));
			if (unknown.length) {
				return json({ error: `Unknown scope(s): ${unknown.join(', ')}` }, { status: 400 });
			}
			// An empty array is meaningfully different from omitting the field entirely: omitted
			// means "unscoped" (read-only default, see hasApiScope), an explicit [] here would mean
			// the same thing — normalize to null so both paths behave identically.
			scopes = body.scopes.length > 0 ? body.scopes : null;
		}

		const { record, fullKey } = await createApiKey(locals.user.id, name, expiresAt, scopes, {
			orgId: locals.organization?.id,
			projectId: locals.project?.id
		});
		return json({ key: record, fullKey });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
