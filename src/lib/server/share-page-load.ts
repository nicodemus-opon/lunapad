import { error, redirect } from '@sveltejs/kit';
import { getShareByTokenOrSlug, toPublicShareView, type ShareRecord } from './shared-reports';
import { isShareExpired, prefetchLiveShareResults } from './share-run';
import { hasOrganizationMembership, getOrganizationTheme } from './tenancy';
import type { WorkspaceTheme } from '../types/theme';

export interface SharePageLoadResult {
	share: ReturnType<typeof toPublicShareView>;
	initialLiveResults: Record<string, { rows: Record<string, unknown>[]; columns: string[] } | null>;
	isAuthenticated: boolean;
	embed: boolean;
	brandTheme: WorkspaceTheme | null;
}

export async function loadSharePage(opts: {
	identifier: string;
	localsUser: { id: string } | null;
	urlPath: string;
	urlSearch: string;
	requireAuth?: boolean;
}): Promise<SharePageLoadResult> {
	const share = await getShareByTokenOrSlug(opts.identifier);
	if (!share || share.revoked) error(404, 'This report link is not available.');
	if (isShareExpired(share)) error(410, 'This report link has expired.');

	const needsAuth = opts.requireAuth ?? share.requireAuth;
	if (needsAuth && !opts.localsUser) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(opts.urlPath + opts.urlSearch)}`);
	}
	if (needsAuth && opts.localsUser) {
		const allowed = await hasOrganizationMembership(share.orgId, opts.localsUser.id);
		if (!allowed) error(403, 'This report is private.');
	}

	const filters = Object.fromEntries(new URLSearchParams(opts.urlSearch));
	const initialLiveResults = await prefetchLiveShareResults(share as ShareRecord, filters);
	const brandTheme = await getOrganizationTheme(share.orgId).catch(() => null);

	return {
		share: toPublicShareView(share),
		initialLiveResults,
		isAuthenticated: Boolean(opts.localsUser),
		embed: new URLSearchParams(opts.urlSearch).get('embed') === '1',
		brandTheme
	};
}
