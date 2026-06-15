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
	let raw: EmbedPayload | EmbedPayload[];
	try {
		raw = (await request.json()) as EmbedPayload | EmbedPayload[];
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const cells = Array.isArray(raw) ? raw : [raw];
	const valid = cells.filter((b) => b.notebookId && b.cellId && b.outputName);
	if (valid.length === 0) {
		return json({ error: 'notebookId, cellId, outputName required' }, { status: 400 });
	}

	try {
		await inngest.send({
			name: 'ai/embed-cells',
			data: { cells: valid }
		});
	} catch (err) {
		// Inngest is optional — log the failure but don't surface it to the client
		console.error('[embed] inngest.send failed:', err);
	}

	return json({ ok: true });
};
