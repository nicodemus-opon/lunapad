import { serve } from 'inngest/sveltekit';
import { inngest } from '$lib/inngest/client';
import { dbtRunFunction } from '$lib/inngest/functions/dbt-run';
import { dbtSchedulerFunction } from '$lib/inngest/functions/dbt-scheduler';

export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: [dbtRunFunction, dbtSchedulerFunction]
});
