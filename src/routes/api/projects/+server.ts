import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { can, userFromLocals } from '$lib/server/permissions';
import { createProject, listProjects } from '$lib/server/tenancy';
import { logAuditEvent } from '$lib/server/audit';
import {
	assertCountEntitlement,
	entitlementViolation,
	EntitlementError
} from '$lib/server/entitlements';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	const projects = await listProjects(locals.organization.id);
	return json({ projects, activeProjectId: locals.project?.id ?? null });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.organization) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!can(userFromLocals(locals.user), 'admin:manage')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	const body = await request.json();
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'Project name is required.' }, { status: 400 });
	try {
		const existing = await listProjects(locals.organization.id);
		assertCountEntitlement({
			code: 'max_projects',
			limit: locals.entitlements?.maxProjects ?? 1,
			usage: existing.length,
			label: 'project(s)'
		});
	} catch (err) {
		if (err instanceof EntitlementError) {
			return json(
				{ error: 'Plan limit reached.', violation: entitlementViolation(err) },
				{ status: 403 }
			);
		}
		throw err;
	}
	const project = await createProject(locals.organization.id, name);
	await logAuditEvent({
		actorId: locals.user.id,
		orgId: locals.organization.id,
		projectId: project.id,
		action: 'project.created',
		resourceType: 'project',
		resourceId: project.id,
		metadata: { name: project.name }
	});
	return json({ project }, { status: 201 });
};
