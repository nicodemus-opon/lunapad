import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db.js';

interface OutcomePayload {
	sessionId: string;
	cellId?: string;
	outputName?: string;
	outcome: 'kept' | 'modified' | 'deleted';
	originalCode?: string;
	finalCode?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: OutcomePayload;
	try {
		body = (await request.json()) as OutcomePayload;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body.sessionId || !body.outcome) {
		return json({ error: 'sessionId and outcome required' }, { status: 400 });
	}

	try {
		await query(
			`INSERT INTO workspace_patterns (session_id, cell_id, output_name, outcome, original_code, final_code)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				body.sessionId,
				body.cellId ?? null,
				body.outputName ?? null,
				body.outcome,
				body.originalCode ?? null,
				body.finalCode ?? null
			]
		);
	} catch {
		// DB not available — silently ignore
	}

	return json({ ok: true });
};
