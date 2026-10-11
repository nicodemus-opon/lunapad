import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scaffoldDbtProject, type ScaffoldDbtAdapter } from '$lib/server/project';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

const SCAFFOLD_ADAPTERS: ScaffoldDbtAdapter[] = ['duckdb', 'postgres', 'trino'];

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder, name, adapter } = (await request.json()) as {
			folder?: string;
			name?: string;
			adapter?: string;
		};
		if (!folder || !name) return json({ error: 'folder and name are required' }, { status: 400 });
		if (adapter !== undefined && !(SCAFFOLD_ADAPTERS as string[]).includes(adapter)) {
			return json(
				{ error: `adapter must be one of: ${SCAFFOLD_ADAPTERS.join(', ')}` },
				{ status: 400 }
			);
		}
		const resolvedFolder = assertTenantProjectFolder(locals, folder);
		await scaffoldDbtProject(resolvedFolder, name, (adapter as ScaffoldDbtAdapter) ?? 'duckdb');
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
