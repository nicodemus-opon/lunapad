import crypto from 'node:crypto';
import { query } from './db.js';
import { ensureSharedReportTables, isValidSlug } from './shared-reports.js';

export interface SiteRecord {
	id: string;
	slug: string;
	name: string;
	requireAuth: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface SitePageRecord {
	id: number;
	siteId: string;
	pageSlug: string;
	navLabel: string;
	shareToken: string;
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
	try {
		await query(`
			CREATE TABLE IF NOT EXISTS sites (
				id           TEXT PRIMARY KEY,
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
				site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
				page_slug   TEXT NOT NULL,
				nav_label   TEXT NOT NULL,
				share_token TEXT NOT NULL REFERENCES shared_reports(token) ON DELETE CASCADE,
				sort_order  INTEGER NOT NULL DEFAULT 0,
				UNIQUE(site_id, page_slug)
			)
		`);
		await query(
			`CREATE INDEX IF NOT EXISTS site_pages_site_id_idx ON site_pages (site_id, sort_order)`
		);
	} catch {
		// Postgres not available — silently skip
	}
}

interface SiteRow {
	id: string;
	slug: string;
	name: string;
	require_auth: boolean;
	created_at: string;
	updated_at: string;
}

function rowToSite(row: SiteRow): SiteRecord {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		requireAuth: row.require_auth,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

interface SitePageRow {
	id: number;
	site_id: string;
	page_slug: string;
	nav_label: string;
	share_token: string;
	sort_order: number;
}

function rowToPage(row: SitePageRow): SitePageRecord {
	return {
		id: row.id,
		siteId: row.site_id,
		pageSlug: row.page_slug,
		navLabel: row.nav_label,
		shareToken: row.share_token,
		sortOrder: row.sort_order
	};
}

export async function listSites(): Promise<SiteRecord[]> {
	await ensureSiteTables();
	const rows = await query<SiteRow>(`SELECT * FROM sites ORDER BY name`).catch(() => []);
	return rows.map(rowToSite);
}

export async function getSiteBySlug(slug: string): Promise<SiteRecord | null> {
	await ensureSiteTables();
	const rows = await query<SiteRow>(`SELECT * FROM sites WHERE slug = $1`, [slug]).catch(() => []);
	return rows[0] ? rowToSite(rows[0]) : null;
}

export async function getSiteById(id: string): Promise<SiteRecord | null> {
	await ensureSiteTables();
	const rows = await query<SiteRow>(`SELECT * FROM sites WHERE id = $1`, [id]).catch(() => []);
	return rows[0] ? rowToSite(rows[0]) : null;
}

export async function createSite(input: {
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
		await query(`INSERT INTO sites (id, slug, name, require_auth) VALUES ($1, $2, $3, $4)`, [
			id,
			input.slug,
			input.name,
			input.requireAuth ?? false
		]);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That slug is already taken.');
		throw err;
	}
	const saved = await getSiteById(id);
	if (!saved) throw new Error('Failed to create site');
	return saved;
}

export async function updateSite(
	id: string,
	input: { slug?: string; name?: string; requireAuth?: boolean }
): Promise<SiteRecord> {
	await ensureSiteTables();
	const existing = await getSiteById(id);
	if (!existing) throw new Error('Site not found');
	const slug = input.slug ?? existing.slug;
	if (!isValidSlug(slug)) {
		throw new Error('Slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.');
	}
	try {
		await query(
			`UPDATE sites SET slug = $1, name = $2, require_auth = $3, updated_at = NOW() WHERE id = $4`,
			[slug, input.name ?? existing.name, input.requireAuth ?? existing.requireAuth, id]
		);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That slug is already taken.');
		throw err;
	}
	const saved = await getSiteById(id);
	if (!saved) throw new Error('Failed to update site');
	return saved;
}

export async function deleteSite(id: string): Promise<void> {
	await ensureSiteTables();
	await query(`DELETE FROM sites WHERE id = $1`, [id]);
}

export async function listSitePages(siteId: string): Promise<SitePageRecord[]> {
	await ensureSiteTables();
	const rows = await query<SitePageRow>(
		`SELECT * FROM site_pages WHERE site_id = $1 ORDER BY sort_order`,
		[siteId]
	).catch(() => []);
	return rows.map(rowToPage);
}

export async function addPageToSite(input: {
	siteId: string;
	pageSlug: string;
	navLabel: string;
	shareToken: string;
}): Promise<SitePageRecord> {
	await ensureSiteTables();
	if (!isValidSlug(input.pageSlug)) {
		throw new Error(
			'Page slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.'
		);
	}
	const existing = await listSitePages(input.siteId);
	const nextOrder = existing.length > 0 ? Math.max(...existing.map((p) => p.sortOrder)) + 1 : 0;
	let rows: SitePageRow[];
	try {
		rows = await query<SitePageRow>(
			`INSERT INTO site_pages (site_id, page_slug, nav_label, share_token, sort_order)
			 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
			[input.siteId, input.pageSlug, input.navLabel, input.shareToken, nextOrder]
		);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That page slug is already used in this site.');
		throw err;
	}
	return rowToPage(rows[0]);
}

export async function removePageFromSite(pageId: number): Promise<void> {
	await ensureSiteTables();
	await query(`DELETE FROM site_pages WHERE id = $1`, [pageId]);
}

/** Persists a new page order within a site — `orderedPageIds` must contain every page id for that site. */
export async function reorderPages(siteId: string, orderedPageIds: number[]): Promise<void> {
	await ensureSiteTables();
	for (let i = 0; i < orderedPageIds.length; i++) {
		await query(`UPDATE site_pages SET sort_order = $1 WHERE id = $2 AND site_id = $3`, [
			i,
			orderedPageIds[i],
			siteId
		]);
	}
}

export async function updatePage(
	pageId: number,
	input: { pageSlug?: string; navLabel?: string }
): Promise<SitePageRecord> {
	await ensureSiteTables();
	const rows = await query<SitePageRow>(`SELECT * FROM site_pages WHERE id = $1`, [pageId]);
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
			`UPDATE site_pages SET page_slug = $1, nav_label = $2 WHERE id = $3 RETURNING *`,
			[pageSlug, input.navLabel ?? existing.nav_label, pageId]
		);
		return rowToPage(updated[0]);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That page slug is already used in this site.');
		throw err;
	}
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
		`SELECT sp.*, sr.notebook_name, sr.revoked
		 FROM site_pages sp
		 JOIN shared_reports sr ON sr.token = sp.share_token
		 WHERE sp.site_id = $1
		 ORDER BY sp.sort_order`,
		[site.id]
	).catch(() => []);
	return {
		...site,
		pages: rows.map((r) => ({ ...rowToPage(r), notebookName: r.notebook_name, revoked: r.revoked }))
	};
}
