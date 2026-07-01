import type { PageServerLoad } from './$types';

// Surfaces PROJECT_FOLDER and DEMO_MODE (server-only env) to the client. In demo mode
// every /api/project/* call is blocked anyway (see hooks.server.ts), so don't bother
// sending a folder the client can't open. demoMode tells notebook.svelte.ts whether to
// use the Postgres-backed /api/workspace/* endpoints or stick to localStorage only —
// the client otherwise has no way to see this server-only env var.
export const load: PageServerLoad = () => {
	const demoMode = process.env.DEMO_MODE === '1';
	const defaultProjectFolder = demoMode ? null : (process.env.PROJECT_FOLDER ?? null);
	return { defaultProjectFolder, demoMode };
};
