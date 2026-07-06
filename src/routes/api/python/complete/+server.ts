import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requestPythonIntel, type PythonTableDescriptor } from '$lib/server/python-runner';

export const POST: RequestHandler = async ({ request }) => {
	const { notebookId, code, line, column, tableDescriptors } = (await request.json()) as {
		notebookId?: string;
		code?: string;
		line?: number;
		column?: number;
		tableDescriptors?: PythonTableDescriptor[];
	};
	if (typeof notebookId !== 'string' || typeof code !== 'string') {
		return json({ completions: [] });
	}
	const result = await requestPythonIntel(
		notebookId,
		'complete',
		code,
		line ?? 1,
		column ?? 0,
		tableDescriptors ?? []
	);
	return json(result);
};
