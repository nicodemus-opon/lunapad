import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	resolveWorkspaceUpdatedBy,
	saveWorkspaceState,
	WorkspaceConflictError
} from '$lib/server/workspace-store';
import { logAuditEvent } from '$lib/server/audit';
import { can, userFromLocals } from '$lib/server/permissions';

interface SaveWorkspaceRequest {
	data: unknown;
	expectedUpdatedAt?: string | null;
	force?: boolean;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = userFromLocals(locals.user);
	if (!can(user, 'workspace:write')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = (await request.json()) as Partial<SaveWorkspaceRequest>;
	if (!body || typeof body !== 'object' || !('data' in body)) {
		return json({ error: 'Workspace payload is required.' }, { status: 400 });
	}
	try {
		const row = await saveWorkspaceState(body.data, locals.user?.id ?? null, {
			expectedUpdatedAt: body.expectedUpdatedAt ?? null,
			force: body.force === true,
			projectId: locals.project?.id
		});
		if (body.force) {
			await logAuditEvent({
				actorId: locals.user?.id,
				orgId: locals.organization?.id,
				projectId: locals.project?.id,
				action: 'workspace.force_save',
				resourceType: 'workspace',
				resourceId: locals.project?.id ?? 'default'
			});
		}
		return json({
			ok: true,
			updatedAt: row.updatedAt,
			updatedBy: await resolveWorkspaceUpdatedBy(row.updatedBy)
		});
	} catch (err) {
		if (err instanceof WorkspaceConflictError) {
			return json(
				{
					error: err.message,
					conflict: true,
					updatedAt: err.updatedAt,
					updatedBy: await resolveWorkspaceUpdatedBy(err.updatedBy)
				},
				{ status: 409 }
			);
		}
		const message = err instanceof Error ? err.message : 'Failed to save workspace state.';
		return json({ error: message }, { status: 503 });
	}
};
