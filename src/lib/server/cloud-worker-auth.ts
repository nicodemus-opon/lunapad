import { json } from '@sveltejs/kit';

export function requireCloudWorkerAuth(request: Request): Response | null {
	const token = process.env.CLOUD_WORKER_TOKEN;
	if (!token) {
		return json(
			{ error: 'Cloud worker token is not configured.', code: 'worker_token_missing' },
			{ status: 503 }
		);
	}
	const presented = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!presented || presented !== token) {
		return json({ error: 'Unauthorized', code: 'worker_unauthorized' }, { status: 401 });
	}
	return null;
}
