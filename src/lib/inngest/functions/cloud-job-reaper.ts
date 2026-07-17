import { inngest } from '../client';
import { failTimedOutCloudJobs } from '$lib/server/cloud-jobs';

// A worker can die mid-job (OOM, redeploy, container restart) while holding a
// lease. Nothing else ever transitions that job out of 'running' — the SSE
// endpoints only resolve on a terminal status — so without this sweep a single
// crashed worker leaves the cell spinning in the UI forever. Runs across every
// org (`orgId: null`), not just the self-hosted default one.
export const cloudJobReaperFunction = inngest.createFunction(
	{
		id: 'cloud-job-reaper',
		triggers: [{ cron: '* * * * *' }]
	},
	async ({ step }) => {
		const jobs = await step.run('reap-timed-out-jobs', () =>
			failTimedOutCloudJobs({ orgId: null, limit: 500 })
		);
		return { reaped: jobs.length };
	}
);
