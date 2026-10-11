import { inngest } from '../client';
import { listScheduleFolders, loadSchedules, isDueNow } from '$lib/server/dbt-schedules';
import type { DbtRunEventData } from './dbt-run';

export const dbtSchedulerFunction = inngest.createFunction(
	{
		id: 'dbt-scheduler',
		triggers: [{ cron: '* * * * *' }]
	},
	async ({ step }) => {
		// Enumerated per tick rather than read from a single in-memory "current
		// folder", so this works across replicas and covers every project that has
		// schedules — not just the last one opened on this instance.
		const folders = listScheduleFolders();
		if (folders.length === 0) return { skipped: true, reason: 'no project open' };

		const events: Array<{ name: 'dbt/run'; data: DbtRunEventData }> = [];
		const fired: string[] = [];

		for (const folder of folders) {
			const due = loadSchedules(folder).filter((s) => s.enabled && isDueNow(s.cron));
			for (const s of due) {
				events.push({
					name: 'dbt/run',
					data: {
						folder,
						select: s.select || undefined,
						scheduleId: s.id,
						label: s.label
					}
				});
				fired.push(s.label);
			}
		}

		if (events.length === 0) return { fired: 0 };

		await step.sendEvent('dispatch', events);

		return { fired: fired.length, schedules: fired };
	}
);
