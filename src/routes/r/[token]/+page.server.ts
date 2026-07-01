import type { PageServerLoad } from './$types';
import { loadSharePage } from '$lib/server/share-page-load';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	return loadSharePage({
		identifier: params.token,
		localsUser: locals.user,
		urlPath: url.pathname,
		urlSearch: url.search
	});
};
