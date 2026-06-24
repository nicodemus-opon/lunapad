import type { PageServerLoad } from './$types';

// Surfaces PROJECT_FOLDER (server-only env) to the client so it can auto-open it on
// first load. In demo mode every /api/project/* call is blocked anyway (see
// hooks.server.ts), so don't bother sending a folder the client can't open.
export const load: PageServerLoad = () => {
	const defaultProjectFolder = process.env.DEMO_MODE === '1' ? null : process.env.PROJECT_FOLDER ?? null;
	return { defaultProjectFolder };
};
