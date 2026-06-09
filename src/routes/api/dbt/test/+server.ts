import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawnDbt } from '$lib/server/dbt-runner';
import { precompileProjectModels, collectProjectModelNames } from '$lib/server/prql-compiler';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { folder, select } = (await request.json()) as { folder?: string; select?: string };
		if (!folder) return json({ error: 'folder is required' }, { status: 400 });

		// Compile .prql → .sql so dbt-fusion can process them
		const knownModels = await collectProjectModelNames(folder);
		await precompileProjectModels(folder, knownModels);

		const args = ['test'];
		if (select) args.push('--select', select);

		const jobId = spawnDbt(args, folder);
		return json({ jobId });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
