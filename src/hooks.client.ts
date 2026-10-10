import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException, initClientSentry } from '$lib/client/sentry.js';

initClientSentry();

export const handleError: HandleClientError = async ({ error }) => {
	void captureClientException(error);
	return { message: 'An unexpected error occurred.' };
};
