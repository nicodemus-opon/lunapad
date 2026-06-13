import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { inngest } from '$lib/inngest/client';

interface EmbedPayload {
	notebookId: string;
	cellId: string;
	outputName: string;
	code: string;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: EmbedPayload;
	try {
		body = (await request.json()) as EmbedPayload;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.notebookId || !body.cellId || !body.outputName) {
		return json({ error: 'notebookId, cellId, outputName required' }, { status: 400 });
	}

	try {
		await inngest.send({
			name: 'ai/embed-cells',
			data: { cells: [body] }
		});
	} catch {
		// Inngest not available — ignore
	}

	return json({ ok: true });
};
