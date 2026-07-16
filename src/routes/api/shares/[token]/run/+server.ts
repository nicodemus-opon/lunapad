import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShareByToken } from '$lib/server/shared-reports';
import { runShareLiveCell } from '$lib/server/share-run';
import { hasOrganizationMembership } from '$lib/server/tenancy';
import { logAuditEvent } from '$lib/server/audit';

interface RunRequest {
	cellId: string;
	filters?: Record<string, string>;
}

function requestIp(request: Request): string | null {
	const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	return (
		forwarded ||
		request.headers.get('x-real-ip') ||
		request.headers.get('cf-connecting-ip') ||
		null
	);
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const token = params.token;
	const share = await getShareByToken(token);
	if (share?.requireAuth) {
		if (!locals.user) {
			await logAuditEvent({
				orgId: share.orgId,
				projectId: share.projectId,
				action: 'share.live_run.denied',
				resourceType: 'share',
				resourceId: token,
				requestId: locals.requestId,
				metadata: { reason: 'unauthorized' }
			});
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		const allowed = await hasOrganizationMembership(share.orgId, locals.user.id);
		if (!allowed) {
			await logAuditEvent({
				actorId: locals.user.id,
				orgId: share.orgId,
				projectId: share.projectId,
				action: 'share.live_run.denied',
				resourceType: 'share',
				resourceId: token,
				requestId: locals.requestId,
				metadata: { reason: 'not_org_member' }
			});
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	const body = (await request.json()) as Partial<RunRequest>;
	if (!body?.cellId) return json({ error: 'cellId is required.' }, { status: 400 });

	const result = await runShareLiveCell(token, body.cellId, body.filters ?? {}, {
		ip: requestIp(request)
	});
	if (share) {
		await logAuditEvent({
			actorId: locals.user?.id,
			orgId: share.orgId,
			projectId: share.projectId,
			action: 'share.live_run',
			resourceType: 'share',
			resourceId: token,
			requestId: locals.requestId,
			metadata: {
				cellId: body.cellId,
				status: 'error' in result ? 'error' : 'ok',
				error: 'error' in result ? result.error : undefined
			}
		});
	}
	if ('error' in result) return json({ error: result.error }, { status: result.status });
	return json(result);
};
