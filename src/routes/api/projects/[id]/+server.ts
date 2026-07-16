import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { archiveProject, updateProject } from '$lib/server/tenancy';
import { logAuditEvent } from '$lib/server/audit';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const project = await updateProject(locals.organization.id, params.id, {
		name: typeof body.name === 'string' ? body.name : undefined
	});
	if (!project) return json({ error: 'Project not found.' }, { status: 404 });
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization.id,
		projectId: project.id,
		action: 'project.updated',
		resourceType: 'project',
		resourceId: project.id,
		metadata: { name: project.name }
	});
	return json({ project });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	try {
		const archived = await archiveProject(locals.organization.id, params.id);
		if (!archived) return json({ error: 'Project not found.' }, { status: 404 });
		await logAuditEvent({
			actorId: locals.user.id,
			orgId: locals.organization.id,
			projectId: params.id,
			action: 'project.archived',
			resourceType: 'project',
			resourceId: params.id
		});
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to archive project.';
		return json({ error: message }, { status: 400 });
	}
};
