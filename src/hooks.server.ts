import type { Handle } from '@sveltejs/kit';
import { setCurrentFolder } from '$lib/server/dbt-schedules';

// If a project folder is pre-configured via env (useful in Docker deployments),
// set it so the Inngest scheduler function can immediately find due schedules.
const startupFolder = process.env.DBT_PROJECT_FOLDER;
if (startupFolder) {
	setCurrentFolder(startupFolder);
}

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	// 'credentialless' (like require-corp) enables crossOriginIsolated/SharedArrayBuffer
	// but does NOT require CORP headers on same-origin resources (require-corp does, which
	// blocks Workers served as static files from sirv that bypasses this hook).
	response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
	return response;
};
