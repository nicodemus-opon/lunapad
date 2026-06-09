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

export const GET: RequestHandler = async ({ url }) => {
	const folder = url.searchParams.get('folder');
	if (!folder) return json({ error: 'folder is required' }, { status: 400 });
	return json({ schedules: loadSchedules(folder) });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const folder = url.searchParams.get('folder');
	if (!folder) return json({ error: 'folder is required' }, { status: 400 });

	const body = (await request.json()) as { schedule?: DbtSchedule };
	if (!body.schedule) return json({ error: 'schedule is required' }, { status: 400 });

	const { cron, label } = body.schedule;
	if (!label?.trim()) return json({ error: 'label is required' }, { status: 400 });
	if (!isValidCron(cron)) return json({ error: 'invalid cron expression' }, { status: 400 });

	const saved = upsertSchedule(folder, body.schedule);
	return json({ schedule: saved });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const folder = url.searchParams.get('folder');
	const id = url.searchParams.get('id');
	if (!folder || !id) return json({ error: 'folder and id are required' }, { status: 400 });
	deleteSchedule(folder, id);
	return json({ ok: true });
};

// Utility: compute next N run times for a cron expression (used by the UI modal)
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { cron?: string; count?: number };
	if (!body.cron) return json({ nextRuns: [] });
	if (!isValidCron(body.cron)) return json({ error: 'invalid cron expression' }, { status: 400 });
	const nextRuns = getNextRuns(body.cron, body.count ?? 3).map((d) => d.toISOString());
	return json({ nextRuns });
};
