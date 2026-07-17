import { json } from '@sveltejs/kit';

function isJsonParseError(err: unknown): boolean {
	return err instanceof SyntaxError;
}

export function sanitizePublicApiError(err: unknown, fallback = 'Request failed.'): string {
	if (isJsonParseError(err)) return 'Invalid JSON request body.';
	return fallback;
}

export function logPublicApiError(surface: string, err: unknown): void {
	console.error(`[public-api:${surface}]`, err);
}

export function publicApiErrorResponse(
	err: unknown,
	opts: { surface: string; status?: number; fallback?: string }
): Response {
	logPublicApiError(opts.surface, err);
	return json(
		{ error: sanitizePublicApiError(err, opts.fallback) },
		{ status: opts.status ?? 400 }
	);
}
