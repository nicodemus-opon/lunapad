import crypto from 'node:crypto';
import { query } from './db.js';
import { ensureSharedReportTables, isValidSlug } from './shared-reports.js';
import {
	DEFAULT_ORG_ID,
	DEFAULT_PROJECT_ID,
	ensureDefaultTenant,
	type TenantRef
} from './tenancy.js';

export interface SiteRecord {
	id: string;
	orgId: string;
	projectId: string;
	slug: string;
	name: string;
	requireAuth: boolean;
	logoUrl: string | null;
	accentColor: string | null;
	showFooter: boolean;
	homePageId: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface SitePageRecord {
	id: number;
	orgId: string;
	projectId: string;
	siteId: string;
	pageSlug: string;
	navLabel: string;
	shareToken: string;
	notebookId: string | null;
	sortOrder: number;
}

export interface SitePageWithReport extends SitePageRecord {
	notebookName: string;
	revoked: boolean;
}

export interface SiteWithPages extends SiteRecord {
	pages: SitePageWithReport[];
}

function isUniqueViolation(err: unknown): boolean {
	return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export async function ensureSiteTables(): Promise<void> {
	// site_pages.share_token FKs into shared_reports — that table must exist first.
	await ensureSharedReportTables();
	await ensureDefaultTenant();
	try {
		await query(`
			CREATE TABLE IF NOT EXISTS sites (
				id           TEXT PRIMARY KEY,
				org_id       TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
				project_id   TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
				slug         TEXT NOT NULL UNIQUE,
				name         TEXT NOT NULL,
				require_auth BOOLEAN NOT NULL DEFAULT FALSE,
				created_at   TIMESTAMPTZ DEFAULT NOW(),
				updated_at   TIMESTAMPTZ DEFAULT NOW()
			)
		`);
		await query(`
			CREATE TABLE IF NOT EXISTS site_pages (
				id          SERIAL PRIMARY KEY,
				org_id      TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
				project_id  TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}',
				site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
				page_slug   TEXT NOT NULL,
				nav_label   TEXT NOT NULL,
				share_token TEXT NOT NULL REFERENCES shared_reports(token) ON DELETE CASCADE,
				notebook_id TEXT,
				sort_order  INTEGER NOT NULL DEFAULT 0,
				UNIQUE(site_id, page_slug)
			)
		`);
		await query(
			`ALTER TABLE sites ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
		);
		await query(
			`ALTER TABLE sites ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
		);
		await query(
			`ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
		);
		await query(
			`ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_ID}'`
		);
		await query(`ALTER TABLE site_pages ADD COLUMN IF NOT EXISTS notebook_id TEXT`);
		await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS logo_url TEXT`);
		await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS accent_color TEXT`);
		await query(
			`ALTER TABLE sites ADD COLUMN IF NOT EXISTS show_footer BOOLEAN NOT NULL DEFAULT TRUE`
		);
		await query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS home_page_id INTEGER`);
		await query(
			`CREATE INDEX IF NOT EXISTS site_pages_site_id_idx ON site_pages (site_id, sort_order)`
		);
		await query(`CREATE INDEX IF NOT EXISTS sites_tenant_idx ON sites (org_id, project_id)`);
	} catch {
		// Postgres not available — silently skip
	}
}

interface SiteRow {
	id: string;
	org_id: string;
	project_id: string;
	slug: string;
	name: string;
	require_auth: boolean;
	logo_url: string | null;
	accent_color: string | null;
	show_footer: boolean;
	home_page_id: number | null;
	created_at: string;
	updated_at: string;
}

function rowToSite(row: SiteRow): SiteRecord {
	return {
		id: row.id,
		orgId: row.org_id ?? DEFAULT_ORG_ID,
		projectId: row.project_id ?? DEFAULT_PROJECT_ID,
		slug: row.slug,
		name: row.name,
		requireAuth: row.require_auth,
		logoUrl: row.logo_url,
		accentColor: row.accent_color,
		showFooter: row.show_footer ?? true,
		homePageId: row.home_page_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

interface SitePageRow {
	id: number;
	org_id: string;
	project_id: string;
	site_id: string;
	page_slug: string;
	nav_label: string;
	share_token: string;
	notebook_id: string | null;
	sort_order: number;
}

function rowToPage(row: SitePageRow): SitePageRecord {
	return {
		id: row.id,
		orgId: row.org_id ?? DEFAULT_ORG_ID,
		projectId: row.project_id ?? DEFAULT_PROJECT_ID,
		siteId: row.site_id,
		pageSlug: row.page_slug,
		navLabel: row.nav_label,
		shareToken: row.share_token,
		notebookId: row.notebook_id,
		sortOrder: row.sort_order
	};
}

export async function listSites(tenant?: TenantRef | null): Promise<SiteRecord[]> {
	await ensureSiteTables();
	const rows = await query<SiteRow>(
		`SELECT * FROM sites WHERE org_id = $1 AND project_id = $2 ORDER BY name`,
		[tenant?.orgId ?? DEFAULT_ORG_ID, tenant?.projectId ?? DEFAULT_PROJECT_ID]
	).catch(() => []);
	return rows.map(rowToSite);
}

export async function getSiteBySlug(slug: string): Promise<SiteRecord | null> {
	await ensureSiteTables();
	const rows = await query<SiteRow>(`SELECT * FROM sites WHERE slug = $1`, [slug]).catch(() => []);
	return rows[0] ? rowToSite(rows[0]) : null;
}

export async function getSiteById(
	id: string,
	tenant?: TenantRef | null
): Promise<SiteRecord | null> {
	await ensureSiteTables();
	const rows = await query<SiteRow>(
		`SELECT * FROM sites WHERE id = $1 AND org_id = $2 AND project_id = $3`,
		[id, tenant?.orgId ?? DEFAULT_ORG_ID, tenant?.projectId ?? DEFAULT_PROJECT_ID]
	).catch(() => []);
	return rows[0] ? rowToSite(rows[0]) : null;
}

export async function createSite(input: {
	tenant?: TenantRef | null;
	slug: string;
	name: string;
	requireAuth?: boolean;
}): Promise<SiteRecord> {
	await ensureSiteTables();
	if (!isValidSlug(input.slug)) {
		throw new Error('Slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.');
	}
	const id = crypto.randomUUID();
	try {
		await query(
			`INSERT INTO sites (id, org_id, project_id, slug, name, require_auth)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				id,
				input.tenant?.orgId ?? DEFAULT_ORG_ID,
				input.tenant?.projectId ?? DEFAULT_PROJECT_ID,
				input.slug,
				input.name,
				input.requireAuth ?? false
			]
		);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That slug is already taken.');
		throw err;
	}
	const saved = await getSiteById(id, input.tenant);
	if (!saved) throw new Error('Failed to create site');
	return saved;
}

export async function updateSite(
	id: string,
	input: {
		tenant?: TenantRef | null;
		slug?: string;
		name?: string;
		requireAuth?: boolean;
		logoUrl?: string | null;
		accentColor?: string | null;
		showFooter?: boolean;
		homePageId?: number | null;
	}
): Promise<SiteRecord> {
	await ensureSiteTables();
	const existing = await getSiteById(id, input.tenant);
	if (!existing) throw new Error('Site not found');
	const slug = input.slug ?? existing.slug;
	if (!isValidSlug(slug)) {
		throw new Error('Slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.');
	}
	try {
		await query(
			`UPDATE sites SET slug = $1, name = $2, require_auth = $3, logo_url = $4, accent_color = $5,
			 show_footer = $6, home_page_id = $7, updated_at = NOW()
			 WHERE id = $8 AND org_id = $9 AND project_id = $10`,
			[
				slug,
				input.name ?? existing.name,
				input.requireAuth ?? existing.requireAuth,
				input.logoUrl !== undefined ? input.logoUrl : existing.logoUrl,
				input.accentColor !== undefined ? input.accentColor : existing.accentColor,
				input.showFooter ?? existing.showFooter,
				input.homePageId !== undefined ? input.homePageId : existing.homePageId,
				id,
				input.tenant?.orgId ?? DEFAULT_ORG_ID,
				input.tenant?.projectId ?? DEFAULT_PROJECT_ID
			]
		);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That slug is already taken.');
		throw err;
	}
	const saved = await getSiteById(id, input.tenant);
	if (!saved) throw new Error('Failed to update site');
	return saved;
}

export async function deleteSite(id: string, tenant?: TenantRef | null): Promise<void> {
	await ensureSiteTables();
	await query(`DELETE FROM sites WHERE id = $1 AND org_id = $2 AND project_id = $3`, [
		id,
		tenant?.orgId ?? DEFAULT_ORG_ID,
		tenant?.projectId ?? DEFAULT_PROJECT_ID
	]);
}

export async function listSitePages(
	siteId: string,
	tenant?: TenantRef | null
): Promise<SitePageRecord[]> {
	await ensureSiteTables();
	const rows = await query<SitePageRow>(
		`SELECT * FROM site_pages WHERE site_id = $1 AND org_id = $2 AND project_id = $3 ORDER BY sort_order`,
		[siteId, tenant?.orgId ?? DEFAULT_ORG_ID, tenant?.projectId ?? DEFAULT_PROJECT_ID]
	).catch(() => []);
	return rows.map(rowToPage);
}

export async function addPageToSite(input: {
	tenant?: TenantRef | null;
	siteId: string;
	pageSlug: string;
	navLabel: string;
	shareToken: string;
	notebookId?: string | null;
}): Promise<SitePageRecord> {
	await ensureSiteTables();
	if (!isValidSlug(input.pageSlug)) {
		throw new Error(
			'Page slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.'
		);
	}
	const site = await getSiteById(input.siteId, input.tenant);
	if (!site) throw new Error('Site not found');
	const { getShareByToken } = await import('./shared-reports.js');
	const share = await getShareByToken(input.shareToken);
	if (!share || share.orgId !== site.orgId || share.projectId !== site.projectId) {
		throw new Error('Share not found in this project.');
	}
	const existing = await listSitePages(input.siteId, input.tenant);
	const nextOrder = existing.length > 0 ? Math.max(...existing.map((p) => p.sortOrder)) + 1 : 0;
	let rows: SitePageRow[];
	try {
		rows = await query<SitePageRow>(
			`INSERT INTO site_pages (org_id, project_id, site_id, page_slug, nav_label, share_token, notebook_id, sort_order)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
			[
				site.orgId,
				site.projectId,
				input.siteId,
				input.pageSlug,
				input.navLabel,
				input.shareToken,
				input.notebookId ?? null,
				nextOrder
			]
		);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That page slug is already used in this site.');
		throw err;
	}
	return rowToPage(rows[0]);
}

export async function removePageFromSite(pageId: number, tenant?: TenantRef | null): Promise<void> {
	await ensureSiteTables();
	await query(`DELETE FROM site_pages WHERE id = $1 AND org_id = $2 AND project_id = $3`, [
		pageId,
		tenant?.orgId ?? DEFAULT_ORG_ID,
		tenant?.projectId ?? DEFAULT_PROJECT_ID
	]);
}

/** Persists a new page order within a site — `orderedPageIds` must contain every page id for that site. */
export async function reorderPages(
	siteId: string,
	orderedPageIds: number[],
	tenant?: TenantRef | null
): Promise<void> {
	await ensureSiteTables();
	for (let i = 0; i < orderedPageIds.length; i++) {
		await query(
			`UPDATE site_pages
			 SET sort_order = $1
			 WHERE id = $2 AND site_id = $3 AND org_id = $4 AND project_id = $5`,
			[
				i,
				orderedPageIds[i],
				siteId,
				tenant?.orgId ?? DEFAULT_ORG_ID,
				tenant?.projectId ?? DEFAULT_PROJECT_ID
			]
		);
	}
}

export async function updatePage(
	pageId: number,
	input: { pageSlug?: string; navLabel?: string; tenant?: TenantRef | null }
): Promise<SitePageRecord> {
	await ensureSiteTables();
	const rows = await query<SitePageRow>(
		`SELECT * FROM site_pages WHERE id = $1 AND org_id = $2 AND project_id = $3`,
		[pageId, input.tenant?.orgId ?? DEFAULT_ORG_ID, input.tenant?.projectId ?? DEFAULT_PROJECT_ID]
	);
	const existing = rows[0];
	if (!existing) throw new Error('Page not found');
	const pageSlug = input.pageSlug ?? existing.page_slug;
	if (!isValidSlug(pageSlug)) {
		throw new Error(
			'Page slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.'
		);
	}
	try {
		const updated = await query<SitePageRow>(
			`UPDATE site_pages
			 SET page_slug = $1, nav_label = $2
			 WHERE id = $3 AND org_id = $4 AND project_id = $5
			 RETURNING *`,
			[
				pageSlug,
				input.navLabel ?? existing.nav_label,
				pageId,
				input.tenant?.orgId ?? DEFAULT_ORG_ID,
				input.tenant?.projectId ?? DEFAULT_PROJECT_ID
			]
		);
		return rowToPage(updated[0]);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That page slug is already used in this site.');
		throw err;
	}
}

export async function resolveShareTokenForPage(page: SitePageRecord): Promise<string> {
	if (page.notebookId) {
		const { getShareByNotebookId } = await import('./shared-reports.js');
		const share = await getShareByNotebookId(page.notebookId, {
			orgId: page.orgId,
			projectId: page.projectId
		});
		if (share && !share.revoked) return share.token;
	}
	return page.shareToken;
}

export async function getSitePageBySlugs(
	siteSlug: string,
	pageSlug: string
): Promise<{ site: SiteRecord; page: SitePageRecord } | null> {
	await ensureSiteTables();
	const site = await getSiteBySlug(siteSlug);
	if (!site) return null;
	const rows = await query<SitePageRow>(
		`SELECT * FROM site_pages WHERE site_id = $1 AND page_slug = $2 AND org_id = $3 AND project_id = $4`,
		[site.id, pageSlug, site.orgId, site.projectId]
	).catch(() => []);
	const pageRow = rows[0];
	if (!pageRow) return null;
	const page = rowToPage(pageRow);
	const resolvedToken = await resolveShareTokenForPage(page);
	return { site, page: { ...page, shareToken: resolvedToken } };
}

interface SiteWithPagesRow extends SitePageRow {
	notebook_name: string;
	revoked: boolean;
}

export async function getSiteWithPages(slug: string): Promise<SiteWithPages | null> {
	await ensureSiteTables();
	const site = await getSiteBySlug(slug);
	if (!site) return null;
	const rows = await query<SiteWithPagesRow>(
		`SELECT sp.*, COALESCE(sr_by_nb.notebook_name, sr.notebook_name) AS notebook_name,
		        COALESCE(sr_by_nb.revoked, sr.revoked) AS revoked
		 FROM site_pages sp
		 LEFT JOIN shared_reports sr ON sr.token = sp.share_token
		 LEFT JOIN shared_reports sr_by_nb ON sr_by_nb.notebook_id = sp.notebook_id
		   AND sr_by_nb.org_id = sp.org_id AND sr_by_nb.project_id = sp.project_id
		   AND NOT sr_by_nb.revoked
		 WHERE sp.site_id = $1
		 ORDER BY sp.sort_order`,
		[site.id]
	).catch(() => []);
	return {
		...site,
		pages: rows.map((r) => ({ ...rowToPage(r), notebookName: r.notebook_name, revoked: r.revoked }))
	};
}
