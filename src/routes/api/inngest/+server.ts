import { serve } from 'inngest/sveltekit';
import { inngest } from '$lib/inngest/client';
import { dbtRunFunction } from '$lib/inngest/functions/dbt-run';
import { dbtSchedulerFunction } from '$lib/inngest/functions/dbt-scheduler';
import { embedCellsFunction } from '$lib/inngest/functions/embed-cells';
import { embedSchemaFunction } from '$lib/inngest/functions/embed-schema';
import { embedMemoryFunction } from '$lib/inngest/functions/embed-memory';

export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: [
		dbtRunFunction,
		dbtSchedulerFunction,
		embedCellsFunction,
		embedSchemaFunction,
		embedMemoryFunction
	]
});
