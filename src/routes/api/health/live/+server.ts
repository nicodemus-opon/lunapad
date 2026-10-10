import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Cheap liveness probe for Docker / Coolify healthchecks and load balancers.
 * Intentionally touches no dependencies (no DB, Redis, S3, Ollama) so frequent
 * polling cannot hammer backing services. Use GET /api/health for deep readiness.
 */
export const GET: RequestHandler = async () => json({ ok: true }, { status: 200 });
