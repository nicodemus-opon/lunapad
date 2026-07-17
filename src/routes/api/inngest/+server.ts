import { serve } from 'inngest/sveltekit';
import { inngest } from '$lib/inngest/client';
import { dbtRunFunction } from '$lib/inngest/functions/dbt-run';
import { dbtSchedulerFunction } from '$lib/inngest/functions/dbt-scheduler';
import { embedCellsFunction } from '$lib/inngest/functions/embed-cells';
import { embedSchemaFunction } from '$lib/inngest/functions/embed-schema';
import { embedMemoryFunction } from '$lib/inngest/functions/embed-memory';
import { cloudJobReaperFunction } from '$lib/inngest/functions/cloud-job-reaper';

export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: [
		dbtRunFunction,
		dbtSchedulerFunction,
		embedCellsFunction,
		embedSchemaFunction,
		embedMemoryFunction,
		cloudJobReaperFunction
	],
	// adapter-node's ORIGIN env var overrides the request Host SvelteKit sees on
	// every request, including the Inngest dev/cloud server's own step-invocation
	// calls. Without this, every registered callback URL becomes ORIGIN's
	// public-facing address (e.g. http://localhost:3967 in docker-compose.cloud.yml)
	// even though Inngest reached this app over the internal Docker network — so
	// every cron/step call fails with "Unable to reach SDK URL" and no cron
	// function (dbt-scheduler, cloud-job-reaper, ...) ever actually runs.
	serveOrigin: process.env.INNGEST_SERVE_ORIGIN
});
