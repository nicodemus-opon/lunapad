import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isSlugAvailable, isValidSlug } from '$lib/server/shared-reports';

export const GET: RequestHandler = async ({ url }) => {
	const slug = url.searchParams.get('slug') ?? '';
	const notebookId = url.searchParams.get('notebookId') ?? undefined;
	if (!isValidSlug(slug)) {
		return json({
			available: false,
			reason: 'Must be 3-64 characters: lowercase letters, numbers, hyphens.'
		});
	}
	const available = await isSlugAvailable(slug, notebookId);
	return json({ available, reason: available ? null : 'That slug is already taken.' });
};
