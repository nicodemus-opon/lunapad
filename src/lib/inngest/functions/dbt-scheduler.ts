import { inngest } from '../client';
import { getCurrentFolder, loadSchedules, isDueNow } from '$lib/server/dbt-schedules';
import type { DbtRunEventData } from './dbt-run';

export const dbtSchedulerFunction = inngest.createFunction(
	{
		id: 'dbt-scheduler',
		triggers: [{ cron: '* * * * *' }]
	},
	async ({ step }) => {
		const folder = getCurrentFolder();
		if (!folder) return { skipped: true, reason: 'no project open' };

		const schedules = loadSchedules(folder);
		const due = schedules.filter((s) => s.enabled && isDueNow(s.cron));

		if (due.length === 0) return { fired: 0 };

		const events = due.map((s) => ({
			name: 'dbt/run' as const,
			data: {
				folder,
				select: s.select || undefined,
				scheduleId: s.id,
				label: s.label
			} satisfies DbtRunEventData
		}));

		await step.sendEvent('dispatch', events);

		return { fired: due.length, schedules: due.map((s) => s.label) };
	}
);
