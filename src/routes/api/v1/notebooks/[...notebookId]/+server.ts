import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRateLimited } from '$lib/server/api-rate-limit';
import { agentActionResponse } from '$lib/server/agent-rest';

// Notebook ids are project-relative paths (e.g. "models/staging/stg_orders"), hence the
// `[...notebookId]` rest parameter rather than a single dynamic segment. Note this means
// literal action suffixes (run/validate) can't live under this same path without becoming
// ambiguous with a notebook id that happens to end in "/run" — see the sibling
// notebooks/run and notebooks/validate routes instead, which take notebookId in the body.
export const GET: RequestHandler = async ({ params, url, locals, request }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 120)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const folder = url.searchParams.get('folder') ?? undefined;
		return agentActionResponse({ locals, request }, 'get_notebook', {
			folder,
			notebookId: params.notebookId
		});
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

// Patch an existing .luna notebook — blueprint (whole-doc replacement), document (raw
// PM replacement), operations (surgical node edits), and/or a title-only rename. Same
// underlying action as the apply_notebook_patch MCP tool.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const rateLimitKey = `v1:${locals.apiKeyId ?? locals.user?.id}`;
	if (isRateLimited(rateLimitKey, 60)) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}
	try {
		const body = (await request.json()) as {
			folder?: string;
			title?: string;
			blueprint?: unknown;
			document?: unknown;
			operations?: unknown;
			executableCells?: unknown;
		};
		return agentActionResponse({ locals, request }, 'apply_notebook_patch', {
			folder: body.folder,
			notebookId: params.notebookId,
			title: body.title,
			blueprint: body.blueprint as never,
			document: body.document as never,
			operations: body.operations as never,
			executableCells: body.executableCells as never
		});
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
