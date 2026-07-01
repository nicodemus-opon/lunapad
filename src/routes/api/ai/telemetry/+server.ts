import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logAuditEvent } from '$lib/server/audit.js';
import type { AgentTelemetryEvent } from '$lib/agent/telemetry.js';

const MUTATING_TOOLS = new Set([
	'create_cell',
	'update_cell',
	'delete_cell',
	'run_cells',
	'move_cell',
	'set_chart',
	'pick_chart',
	'set_view_mode'
]);

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { events?: AgentTelemetryEvent[] };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const events = body.events ?? [];
	if (events.length > 100) return json({ error: 'Too many events' }, { status: 400 });

	for (const ev of events) {
		if (ev.type === 'tool' && ev.tool && MUTATING_TOOLS.has(ev.tool)) {
			try {
				await logAuditEvent({
					actorId: locals.user.id,
					action: `ai.tool.${ev.tool}`,
					resourceType: 'ai_session',
					resourceId: ev.sessionId,
					metadata: {
						turn: ev.turn,
						loop: ev.loop,
						intent: ev.intent,
						...(ev.metadata ?? {})
					}
				});
			} catch {
				// Postgres may be unavailable in local-only mode.
			}
		}
	}

	return json({ ok: true, received: events.length });
};
