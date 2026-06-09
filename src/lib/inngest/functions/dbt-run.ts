import { inngest } from '../client';
import { spawnDbt, getJob } from '$lib/server/dbt-runner';
import { loadSchedules, saveSchedules } from '$lib/server/dbt-schedules';
import { precompileProjectModels, collectProjectModelNames } from '$lib/server/prql-compiler';

export interface DbtRunEventData {
	folder: string;
	select?: string;
	scheduleId?: string;
	label?: string;
}

export const dbtRunFunction = inngest.createFunction(
	{
		id: 'dbt-run',
		retries: 1,
		triggers: [{ event: 'dbt/run' }]
	},
	async ({ event, step }) => {
		const { folder, select, scheduleId, label } = event.data as DbtRunEventData;

		const result = await step.run('execute', async () => {
			// Precompile .prql → .sql before dbt sees them
			try {
				const knownModels = await collectProjectModelNames(folder);
				await precompileProjectModels(folder, knownModels);
			} catch {
				// continue even if precompile partially fails
			}

			const args = ['run', ...(select ? ['--select', select] : [])];
			const jobId = spawnDbt(args, folder);

			// Surface the jobId immediately so the UI can start streaming logs
			if (scheduleId) {
				const schedules = loadSchedules(folder);
				const idx = schedules.findIndex((s) => s.id === scheduleId);
				if (idx !== -1) {
					schedules[idx].lastRunJobId = jobId;
					saveSchedules(folder, schedules);
				}
			}

			// Wait for the dbt subprocess to finish
			const exitCode = await new Promise<number>((resolve) => {
				const job = getJob(jobId);
				if (!job) { resolve(-1); return; }
				if (job.done) { resolve(job.exitCode ?? -1); return; }
				job.emitter.once('done', (code: number) => resolve(code));
			});

			// Persist final status
			if (scheduleId) {
				const schedules = loadSchedules(folder);
				const idx = schedules.findIndex((s) => s.id === scheduleId);
				if (idx !== -1) {
					schedules[idx].lastRunAt = Date.now();
					schedules[idx].lastRunStatus = exitCode === 0 ? 'pass' : 'error';
					schedules[idx].lastRunJobId = jobId;
					saveSchedules(folder, schedules);
				}
			}

			return { jobId, exitCode };
		});

		return {
			label: label ?? 'dbt run',
			folder,
			select,
			...result
		};
	}
);
