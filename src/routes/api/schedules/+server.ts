import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	loadSchedules,
	upsertSchedule,
	deleteSchedule,
	getNextRuns,
	isValidCron
} from '$lib/server/dbt-schedules';
import type { DbtSchedule } from '$lib/types/schedule';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const GET: RequestHandler = async ({ url, locals }) => {
	const requestedFolder = url.searchParams.get('folder');
	if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
	try {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		return json({ schedules: loadSchedules(folder) });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 403 });
	}
};

export const POST: RequestHandler = async ({ request, url, locals }) => {
	const requestedFolder = url.searchParams.get('folder');
	if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });

	const body = (await request.json()) as { schedule?: DbtSchedule };
	if (!body.schedule) return json({ error: 'schedule is required' }, { status: 400 });

	const { cron, label } = body.schedule;
	if (!label?.trim()) return json({ error: 'label is required' }, { status: 400 });
	if (!isValidCron(cron)) return json({ error: 'invalid cron expression' }, { status: 400 });

	try {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		const saved = upsertSchedule(folder, body.schedule);
		return json({ schedule: saved });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 403 });
	}
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	const requestedFolder = url.searchParams.get('folder');
	const id = url.searchParams.get('id');
	if (!requestedFolder || !id)
		return json({ error: 'folder and id are required' }, { status: 400 });
	try {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		deleteSchedule(folder, id);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 403 });
	}
};

// Utility: compute next N run times for a cron expression (used by the UI modal)
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { cron?: string; count?: number };
	if (!body.cron) return json({ nextRuns: [] });
	if (!isValidCron(body.cron)) return json({ error: 'invalid cron expression' }, { status: 400 });
	const nextRuns = getNextRuns(body.cron, body.count ?? 3).map((d) => d.toISOString());
	return json({ nextRuns });
};
