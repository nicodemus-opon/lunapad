import crypto from 'node:crypto';
import path from 'node:path';
import { query } from './db.js';
import { scaffoldDbtProject } from './project.js';
import type { WorkspaceTheme } from '../types/theme.js';

export type DeploymentMode = 'self_hosted' | 'cloud';
export type OrganizationPlan = 'free' | 'starter' | 'free_beta' | 'team' | 'business';
export type OrganizationRole = 'admin' | 'editor' | 'viewer';
export type BillingProvider = 'none' | 'manual' | 'lemonsqueezy';

export const DEFAULT_ORG_ID = 'default';
export const DEFAULT_PROJECT_ID = 'default';

export interface Organization {
	id: string;
	name: string;
	slug: string;
	plan: OrganizationPlan;
	createdAt: string;
	updatedAt: string;
	/** Workspace brand theme (src/lib/types/theme.ts) — null/undefined means
	 *  no brand theme configured, falls back to layout.css's built-in tokens. */
	theme?: WorkspaceTheme | null;
}

export interface Project {
	id: string;
	orgId: string;
	name: string;
	slug: string;
	projectFolder: string | null;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface OrganizationMembership {
	orgId: string;
	userId: string;
	role: OrganizationRole;
	createdAt: string;
	updatedAt: string;
}

export interface Entitlements {
	plan: OrganizationPlan;
	maxProjects: number;
	maxExternalConnections: number;
	maxPublishedShares: number;
	maxConcurrentJobs: number;
	monthlyAiTokens: number;
	maxSchedules: number;
	maxApiRequestsPerMinute: number;
	maxPublicShareRunsPerMinute: number;
	maxStorageMb: number;
}

export interface TenantRef {
	orgId: string;
	projectId?: string | null;
}

export interface TenantContext {
	organization: Organization;
	project: Project;
	membership: OrganizationMembership;
	entitlements: Entitlements;
}

export interface OrganizationListItem {
	organization: Organization;
	membership: OrganizationMembership;
	projects: Project[];
	activeProject: Project | null;
}

export interface WorkspaceSwitcherState {
	organizations: OrganizationListItem[];
	activeOrgId: string;
	activeProjectId: string | null;
}

export interface TenantRepairWarning {
	code:
		| 'user_without_membership'
		| 'org_without_project'
		| 'missing_project_folder'
		| 'stale_active_project';
	message: string;
	orgId?: string | null;
	projectId?: string | null;
	userId?: string | null;
}

export function deploymentMode(): DeploymentMode {
	return process.env.DEPLOYMENT_MODE === 'cloud' ? 'cloud' : 'self_hosted';
}

export function assertCloudTenantRef(tenant: TenantRef, context: string): void {
	if (deploymentMode() !== 'cloud') return;
	if (!tenant.orgId || tenant.orgId === DEFAULT_ORG_ID) {
		throw new Error(`${context} requires an explicit non-default organization in cloud mode.`);
	}
	if (tenant.projectId === DEFAULT_PROJECT_ID) {
		throw new Error(`${context} requires an explicit non-default project in cloud mode.`);
	}
}

export function entitlementsForPlan(plan: OrganizationPlan): Entitlements {
	if (plan === 'business') {
		return {
			plan,
			maxProjects: 50,
			maxExternalConnections: 50,
			maxPublishedShares: 250,
			maxConcurrentJobs: 10,
			monthlyAiTokens: 5_000_000,
			maxSchedules: 100,
			maxApiRequestsPerMinute: 600,
			maxPublicShareRunsPerMinute: 300,
			maxStorageMb: 100_000
		};
	}
	if (plan === 'team') {
		return {
			plan,
			maxProjects: 10,
			maxExternalConnections: 20,
			maxPublishedShares: 100,
			maxConcurrentJobs: 5,
			monthlyAiTokens: 1_000_000,
			maxSchedules: 25,
			maxApiRequestsPerMinute: 300,
			maxPublicShareRunsPerMinute: 120,
			maxStorageMb: 25_000
		};
	}
	if (plan === 'starter' || plan === 'free_beta') {
		return {
			plan,
			maxProjects: 3,
			maxExternalConnections: 5,
			maxPublishedShares: 20,
			maxConcurrentJobs: 2,
			monthlyAiTokens: 150_000,
			maxSchedules: 5,
			maxApiRequestsPerMinute: 120,
			maxPublicShareRunsPerMinute: 60,
			maxStorageMb: 5_000
		};
	}
	return {
		plan,
		maxProjects: 1,
		maxExternalConnections: 2,
		maxPublishedShares: 5,
		maxConcurrentJobs: 1,
		monthlyAiTokens: 50_000,
		maxSchedules: 2,
		maxApiRequestsPerMinute: 60,
		maxPublicShareRunsPerMinute: 30,
		maxStorageMb: 1_000
	};
}

let tenantTablesReady: Promise<void> | null = null;

async function ensureTenantTables(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS organizations (
			id         TEXT PRIMARY KEY,
			name       TEXT NOT NULL,
			slug       TEXT NOT NULL UNIQUE,
			plan       TEXT NOT NULL DEFAULT 'free',
			billing_provider TEXT NOT NULL DEFAULT 'none',
			billing_status TEXT NOT NULL DEFAULT 'none',
			billing_renews_at TIMESTAMPTZ,
			theme      JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await query(
		`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_provider TEXT NOT NULL DEFAULT 'none'`
	);
	await query(
		`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'none'`
	);
	await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_renews_at TIMESTAMPTZ`);
	await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme JSONB`);
	await query(`
		CREATE TABLE IF NOT EXISTS organization_members (
			org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
			user_id    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			role       TEXT NOT NULL DEFAULT 'editor',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, user_id)
		)
	`);
	await query(
		`CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members (user_id)`
	);
	await query(`
		CREATE TABLE IF NOT EXISTS projects (
			id         TEXT PRIMARY KEY,
			org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
			name       TEXT NOT NULL,
			slug       TEXT NOT NULL,
			project_folder TEXT,
			archived_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			UNIQUE (org_id, slug)
		)
	`);
	await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_folder TEXT`);
	await query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
	if (process.env.PROJECT_FOLDER) {
		await query(
			`UPDATE projects SET project_folder = $1 WHERE id = $2 AND project_folder IS NULL`,
			[process.env.PROJECT_FOLDER, DEFAULT_PROJECT_ID]
		);
	}
	await query(`CREATE INDEX IF NOT EXISTS projects_org_idx ON projects (org_id)`);
}

export function ensureTenantTablesOnce(): Promise<void> {
	if (!tenantTablesReady) tenantTablesReady = ensureTenantTables();
	return tenantTablesReady;
}

function toOrganization(row: {
	id: string;
	name: string;
	slug: string;
	plan: string;
	created_at: string;
	updated_at: string;
	theme?: WorkspaceTheme | null;
}): Organization {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		plan: row.plan as OrganizationPlan,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		theme: row.theme ?? null
	};
}

function toProject(row: {
	id: string;
	org_id: string;
	name: string;
	slug: string;
	project_folder?: string | null;
	archived_at: string | null;
	created_at: string;
	updated_at: string;
}): Project {
	return {
		id: row.id,
		orgId: row.org_id,
		name: row.name,
		slug: row.slug,
		projectFolder: row.project_folder ?? null,
		archivedAt: row.archived_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export function projectsRoot(): string {
	const fallback = process.env.PROJECT_FOLDER
		? path.join(path.dirname(process.env.PROJECT_FOLDER), 'projects')
		: path.join(process.cwd(), 'projects');
	return path.resolve(process.env.PROJECTS_ROOT ?? fallback);
}

export function projectFolderFor(orgId: string, projectId: string): string {
	return path.join(projectsRoot(), orgId, projectId);
}

function dbtProjectName(input: string): string {
	const name = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 48);
	return name || 'lunapad_project';
}

export async function ensureProjectScaffold(
	project: Pick<Project, 'name' | 'projectFolder'>
): Promise<void> {
	if (!project.projectFolder) return;
	await scaffoldDbtProject(project.projectFolder, dbtProjectName(project.name));
}

function toMembership(row: {
	org_id: string;
	user_id: string;
	role: string;
	created_at: string;
	updated_at: string;
}): OrganizationMembership {
	return {
		orgId: row.org_id,
		userId: row.user_id,
		role: row.role as OrganizationRole,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function ensureDefaultTenant(): Promise<{
	organization: Organization;
	project: Project;
}> {
	await ensureTenantTablesOnce();
	const orgRows = await query<{
		id: string;
		name: string;
		slug: string;
		plan: string;
		created_at: string;
		updated_at: string;
		theme: WorkspaceTheme | null;
	}>(
		`INSERT INTO organizations (id, name, slug, plan)
		 VALUES ($1, 'Default organization', 'default', 'team')
		 ON CONFLICT (id) DO UPDATE SET updated_at = organizations.updated_at
		 RETURNING id, name, slug, plan, created_at, updated_at, theme`,
		[DEFAULT_ORG_ID]
	);
	const projectRows = await query<{
		id: string;
		org_id: string;
		name: string;
		slug: string;
		project_folder: string | null;
		archived_at: string | null;
		created_at: string;
		updated_at: string;
	}>(
		`INSERT INTO projects (id, org_id, name, slug, project_folder)
		 VALUES ($1, $2, 'Default project', 'default', $3)
		 ON CONFLICT (id) DO UPDATE SET updated_at = projects.updated_at
		 RETURNING id, org_id, name, slug, project_folder, archived_at, created_at, updated_at`,
		[DEFAULT_PROJECT_ID, DEFAULT_ORG_ID, process.env.PROJECT_FOLDER ?? null]
	);
	return { organization: toOrganization(orgRows[0]), project: toProject(projectRows[0]) };
}

export async function ensureDefaultMembership(
	userId: string,
	role: OrganizationRole
): Promise<OrganizationMembership> {
	await ensureDefaultTenant();
	const rows = await query<{
		org_id: string;
		user_id: string;
		role: string;
		created_at: string;
		updated_at: string;
	}>(
		`INSERT INTO organization_members (org_id, user_id, role)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (org_id, user_id) DO UPDATE
		 SET role = CASE
			 WHEN organization_members.role = 'admin' THEN organization_members.role
			 ELSE EXCLUDED.role
		 END,
		     updated_at = now()
		 RETURNING org_id, user_id, role, created_at, updated_at`,
		[DEFAULT_ORG_ID, userId, role]
	);
	return toMembership(rows[0]);
}

export async function resolveTenantContext(
	user: { id: string; role?: string | null },
	preferredProjectId?: string | null,
	preferredOrgId?: string | null
): Promise<TenantContext> {
	await ensureTenantTablesOnce();
	const rows = await query<{
		org_id: string;
		user_id: string;
		role: string;
		membership_created_at: string;
		membership_updated_at: string;
		organization_id: string;
		organization_name: string;
		organization_slug: string;
		organization_plan: string;
		organization_created_at: string;
		organization_updated_at: string;
		organization_theme: WorkspaceTheme | null;
		project_id: string;
		project_org_id: string;
		project_name: string;
		project_slug: string;
		project_folder: string | null;
		project_archived_at: string | null;
		project_created_at: string;
		project_updated_at: string;
	}>(
		`SELECT m.org_id, m.user_id, m.role, m.created_at AS membership_created_at,
		        m.updated_at AS membership_updated_at,
		        o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug,
		        o.plan AS organization_plan, o.created_at AS organization_created_at,
		        o.updated_at AS organization_updated_at, o.theme AS organization_theme,
		        p.id AS project_id, p.org_id AS project_org_id, p.name AS project_name,
		        p.project_folder AS project_folder,
		        p.slug AS project_slug, p.archived_at AS project_archived_at,
		        p.created_at AS project_created_at,
		        p.updated_at AS project_updated_at
		 FROM organization_members m
		 JOIN organizations o ON o.id = m.org_id
		 JOIN projects p ON p.org_id = o.id
		 WHERE m.user_id = $1
		   AND ($2::text IS NULL OR p.id = $2)
		   AND ($3::text IS NULL OR o.id = $3)
		   AND p.archived_at IS NULL
		 ORDER BY o.created_at ASC, p.created_at ASC
		 LIMIT 1`,
		[user.id, preferredProjectId ?? null, preferredOrgId ?? null]
	);
	const row = rows[0];
	if (!row && deploymentMode() === 'self_hosted') {
		const { organization, project } = await ensureDefaultTenant();
		const membership = await ensureDefaultMembership(
			user.id,
			user.role === 'admin' ? 'admin' : user.role === 'viewer' ? 'viewer' : 'editor'
		);
		return {
			organization,
			project,
			membership,
			entitlements: entitlementsForPlan(organization.plan)
		};
	}
	if (!row) throw new Error('No organization membership found for this user.');
	const organization = toOrganization({
		id: row.organization_id,
		name: row.organization_name,
		slug: row.organization_slug,
		plan: row.organization_plan,
		created_at: row.organization_created_at,
		updated_at: row.organization_updated_at,
		theme: row.organization_theme
	});
	const project = toProject({
		id: row.project_id,
		org_id: row.project_org_id,
		name: row.project_name,
		slug: row.project_slug,
		project_folder: row.project_folder,
		archived_at: row.project_archived_at,
		created_at: row.project_created_at,
		updated_at: row.project_updated_at
	});
	const membership = toMembership({
		org_id: row.org_id,
		user_id: row.user_id,
		role: row.role,
		created_at: row.membership_created_at,
		updated_at: row.membership_updated_at
	});
	return {
		organization,
		project,
		membership,
		entitlements: entitlementsForPlan(organization.plan)
	};
}

function slugify(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'project';
}

async function uniqueProjectSlug(orgId: string, base: string): Promise<string> {
	let slug = slugify(base);
	for (let i = 2; ; i++) {
		const rows = await query<{ id: string }>(
			`SELECT id FROM projects WHERE org_id = $1 AND slug = $2 LIMIT 1`,
			[orgId, slug]
		);
		if (rows.length === 0) return slug;
		slug = `${slugify(base)}-${i}`;
	}
}

export async function createOrganizationForUser(input: {
	userId: string;
	userName?: string | null;
	email?: string | null;
	orgName?: string | null;
	projectName?: string | null;
	plan?: OrganizationPlan;
}): Promise<TenantContext> {
	await ensureTenantTablesOnce();
	const orgId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const orgName =
		input.orgName?.trim() || (input.userName ? `${input.userName}'s workspace` : 'My workspace');
	const orgSlug = `${slugify(orgName)}-${orgId.slice(0, 8)}`;
	const projectName = input.projectName?.trim() || 'Starter project';
	const projectFolder = projectFolderFor(orgId, projectId);
	await scaffoldDbtProject(projectFolder, dbtProjectName(projectName));
	await query(`INSERT INTO organizations (id, name, slug, plan) VALUES ($1, $2, $3, $4)`, [
		orgId,
		orgName,
		orgSlug,
		input.plan ?? 'free'
	]);
	await query(
		`INSERT INTO projects (id, org_id, name, slug, project_folder)
		 VALUES ($1, $2, $3, $4, $5)`,
		[projectId, orgId, projectName, await uniqueProjectSlug(orgId, projectName), projectFolder]
	);
	await query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'admin')`, [
		orgId,
		input.userId
	]);
	return resolveTenantContext({ id: input.userId, role: 'admin' }, projectId, orgId);
}

export async function listOrganizationsForUser(
	userId: string,
	activeOrgId?: string | null,
	activeProjectId?: string | null
): Promise<OrganizationListItem[]> {
	await ensureTenantTablesOnce();
	const orgRows = await query<{
		org_id: string;
		user_id: string;
		role: string;
		membership_created_at: string;
		membership_updated_at: string;
		organization_id: string;
		organization_name: string;
		organization_slug: string;
		organization_plan: string;
		organization_created_at: string;
		organization_updated_at: string;
		organization_theme: WorkspaceTheme | null;
	}>(
		`SELECT m.org_id, m.user_id, m.role, m.created_at AS membership_created_at,
		        m.updated_at AS membership_updated_at,
		        o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug,
		        o.plan AS organization_plan, o.created_at AS organization_created_at,
		        o.updated_at AS organization_updated_at, o.theme AS organization_theme
		 FROM organization_members m
		 JOIN organizations o ON o.id = m.org_id
		 WHERE m.user_id = $1
		 ORDER BY o.created_at ASC`,
		[userId]
	);
	const items: OrganizationListItem[] = [];
	for (const row of orgRows) {
		const projects = await listProjects(row.organization_id);
		const preferred =
			row.organization_id === activeOrgId
				? projects.find((project) => project.id === activeProjectId)
				: null;
		items.push({
			organization: toOrganization({
				id: row.organization_id,
				name: row.organization_name,
				slug: row.organization_slug,
				plan: row.organization_plan,
				created_at: row.organization_created_at,
				updated_at: row.organization_updated_at,
				theme: row.organization_theme
			}),
			membership: toMembership({
				org_id: row.org_id,
				user_id: row.user_id,
				role: row.role,
				created_at: row.membership_created_at,
				updated_at: row.membership_updated_at
			}),
			projects,
			activeProject: preferred ?? projects[0] ?? null
		});
	}
	return items;
}

export async function updateOrganization(
	orgId: string,
	input: { name?: string; theme?: WorkspaceTheme | null }
): Promise<Organization | null> {
	await ensureTenantTablesOnce();
	const name = input.name?.trim();
	const hasTheme = 'theme' in input;
	if (!name && !hasTheme) return null;
	const rows = await query<{
		id: string;
		name: string;
		slug: string;
		plan: string;
		created_at: string;
		updated_at: string;
		theme: WorkspaceTheme | null;
	}>(
		`UPDATE organizations
		 SET name = COALESCE($2, name),
		     theme = CASE WHEN $3 THEN $4::jsonb ELSE theme END,
		     updated_at = now()
		 WHERE id = $1
		 RETURNING id, name, slug, plan, created_at, updated_at, theme`,
		[orgId, name ?? null, hasTheme, hasTheme ? JSON.stringify(input.theme) : null]
	);
	return rows[0] ? toOrganization(rows[0]) : null;
}

/** Public read of just an org's brand theme — no membership/auth check, since
 *  this is used to color publicly shared report pages (src/lib/server/share-page-load.ts)
 *  for visitors who aren't necessarily members of the org. */
export async function getOrganizationTheme(orgId: string): Promise<WorkspaceTheme | null> {
	await ensureTenantTablesOnce();
	const rows = await query<{ theme: WorkspaceTheme | null }>(
		`SELECT theme FROM organizations WHERE id = $1`,
		[orgId]
	);
	return rows[0]?.theme ?? null;
}

export async function leaveOrganization(input: {
	orgId: string;
	userId: string;
}): Promise<boolean> {
	await ensureTenantTablesOnce();
	const membershipRows = await query<{ role: string }>(
		`SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
		[input.orgId, input.userId]
	);
	const membership = membershipRows[0];
	if (!membership) return false;
	if (membership.role === 'admin') {
		const adminRows = await query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM organization_members WHERE org_id = $1 AND role = 'admin'`,
			[input.orgId]
		);
		if (Number(adminRows[0]?.count ?? 0) <= 1) {
			throw new Error('Transfer admin access before leaving this workspace.');
		}
	}
	await query(`DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2`, [
		input.orgId,
		input.userId
	]);
	return true;
}

export async function listProjects(orgId: string): Promise<Project[]> {
	await ensureTenantTablesOnce();
	const rows = await query<{
		id: string;
		org_id: string;
		name: string;
		slug: string;
		project_folder: string | null;
		archived_at: string | null;
		created_at: string;
		updated_at: string;
	}>(
		`SELECT id, org_id, name, slug, project_folder, archived_at, created_at, updated_at
		 FROM projects
		 WHERE org_id = $1 AND archived_at IS NULL
		 ORDER BY created_at ASC`,
		[orgId]
	);
	return rows.map(toProject);
}

export async function createProject(orgId: string, name: string): Promise<Project> {
	await ensureTenantTablesOnce();
	const id = crypto.randomUUID();
	const slug = await uniqueProjectSlug(orgId, name);
	const projectFolder = projectFolderFor(orgId, id);
	await scaffoldDbtProject(projectFolder, dbtProjectName(name));
	const rows = await query<{
		id: string;
		org_id: string;
		name: string;
		slug: string;
		project_folder: string | null;
		archived_at: string | null;
		created_at: string;
		updated_at: string;
	}>(
		`INSERT INTO projects (id, org_id, name, slug, project_folder)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, org_id, name, slug, project_folder, archived_at, created_at, updated_at`,
		[id, orgId, name.trim(), slug, projectFolder]
	);
	return toProject(rows[0]);
}

export async function updateProject(
	orgId: string,
	projectId: string,
	input: { name?: string }
): Promise<Project | null> {
	await ensureTenantTablesOnce();
	const existingRows = await query<{ name: string }>(
		`SELECT name FROM projects WHERE id = $1 AND org_id = $2 AND archived_at IS NULL`,
		[projectId, orgId]
	);
	if (!existingRows[0]) return null;
	const name = input.name?.trim() || existingRows[0].name;
	const rows = await query<{
		id: string;
		org_id: string;
		name: string;
		slug: string;
		project_folder: string | null;
		archived_at: string | null;
		created_at: string;
		updated_at: string;
	}>(
		`UPDATE projects
		 SET name = $3, updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND archived_at IS NULL
		 RETURNING id, org_id, name, slug, project_folder, archived_at, created_at, updated_at`,
		[projectId, orgId, name]
	);
	return rows[0] ? toProject(rows[0]) : null;
}

export async function archiveProject(orgId: string, projectId: string): Promise<boolean> {
	await ensureTenantTablesOnce();
	const activeProjects = await listProjects(orgId);
	if (activeProjects.length <= 1) {
		throw new Error('Cannot archive the only active project.');
	}
	const rows = await query<{ id: string }>(
		`UPDATE projects
		 SET archived_at = now(), updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND archived_at IS NULL
		 RETURNING id`,
		[projectId, orgId]
	);
	return rows.length > 0;
}

export async function listOrganizationMembers(orgId: string): Promise<
	Array<{
		id: string;
		name: string;
		email: string;
		image: string | null;
		role: OrganizationRole;
		createdAt: string;
	}>
> {
	await ensureTenantTablesOnce();
	const rows = await query<{
		id: string;
		name: string;
		email: string;
		image: string | null;
		role: string;
		created_at: string;
	}>(
		`SELECT u.id, u.name, u.email, u.image, m.role, m.created_at
		 FROM organization_members m
		 JOIN "user" u ON u.id = m.user_id
		 WHERE m.org_id = $1
		 ORDER BY u.name ASC`,
		[orgId]
	);
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		email: row.email,
		image: row.image,
		role: row.role as OrganizationRole,
		createdAt: row.created_at
	}));
}

export async function setOrganizationMemberRole(input: {
	orgId: string;
	userId: string;
	role: OrganizationRole;
}): Promise<boolean> {
	await ensureTenantTablesOnce();
	if (input.role !== 'admin') {
		const existingRows = await query<{ role: string }>(
			`SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
			[input.orgId, input.userId]
		);
		if (existingRows[0]?.role === 'admin') {
			const adminRows = await query<{ count: string }>(
				`SELECT COUNT(*)::text AS count FROM organization_members WHERE org_id = $1 AND role = 'admin'`,
				[input.orgId]
			);
			if (Number(adminRows[0]?.count ?? 0) <= 1) {
				throw new Error('A workspace must keep at least one admin.');
			}
		}
	}
	const rows = await query<{ user_id: string }>(
		`UPDATE organization_members
		 SET role = $3, updated_at = now()
		 WHERE org_id = $1 AND user_id = $2
		 RETURNING user_id`,
		[input.orgId, input.userId, input.role]
	);
	return rows.length > 0;
}

export async function hasOrganizationMembership(orgId: string, userId: string): Promise<boolean> {
	await ensureTenantTablesOnce();
	const rows = await query<{ user_id: string }>(
		`SELECT user_id FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
		[orgId, userId]
	);
	return rows.length > 0;
}

export async function upsertOrganizationMember(input: {
	orgId: string;
	userId: string;
	role: OrganizationRole;
}): Promise<OrganizationMembership> {
	await ensureTenantTablesOnce();
	const rows = await query<{
		org_id: string;
		user_id: string;
		role: string;
		created_at: string;
		updated_at: string;
	}>(
		`INSERT INTO organization_members (org_id, user_id, role)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (org_id, user_id) DO UPDATE
		 SET role = EXCLUDED.role, updated_at = now()
		 RETURNING org_id, user_id, role, created_at, updated_at`,
		[input.orgId, input.userId, input.role]
	);
	return toMembership(rows[0]);
}

export async function getTenantRepairWarnings(
	input: {
		activeOrgId?: string | null;
		activeProjectId?: string | null;
	} = {}
): Promise<TenantRepairWarning[]> {
	await ensureTenantTablesOnce();
	const warnings: TenantRepairWarning[] = [];
	const usersWithoutMembership = await query<{ id: string; email: string }>(
		`SELECT u.id, u.email
		 FROM "user" u
		 LEFT JOIN organization_members m ON m.user_id = u.id
		 WHERE m.user_id IS NULL
		 LIMIT 50`
	);
	for (const row of usersWithoutMembership) {
		warnings.push({
			code: 'user_without_membership',
			userId: row.id,
			message: `${row.email} has no workspace membership.`
		});
	}
	const orgsWithoutProjects = await query<{ id: string; name: string }>(
		`SELECT o.id, o.name
		 FROM organizations o
		 LEFT JOIN projects p ON p.org_id = o.id AND p.archived_at IS NULL
		 WHERE p.id IS NULL
		 LIMIT 50`
	);
	for (const row of orgsWithoutProjects) {
		warnings.push({
			code: 'org_without_project',
			orgId: row.id,
			message: `${row.name} has no active project.`
		});
	}
	const missingFolders = await query<{ id: string; org_id: string; name: string }>(
		`SELECT id, org_id, name
		 FROM projects
		 WHERE archived_at IS NULL AND (project_folder IS NULL OR btrim(project_folder) = '')
		 LIMIT 50`
	);
	for (const row of missingFolders) {
		warnings.push({
			code: 'missing_project_folder',
			orgId: row.org_id,
			projectId: row.id,
			message: `${row.name} does not have a project folder recorded.`
		});
	}
	if (input.activeOrgId && input.activeProjectId) {
		const activeRows = await query<{ id: string }>(
			`SELECT id FROM projects
			 WHERE id = $1 AND org_id = $2 AND archived_at IS NULL
			 LIMIT 1`,
			[input.activeProjectId, input.activeOrgId]
		);
		if (activeRows.length === 0) {
			warnings.push({
				code: 'stale_active_project',
				orgId: input.activeOrgId,
				projectId: input.activeProjectId,
				message: 'The active project cookie points at a project that is missing or archived.'
			});
		}
	}
	return warnings;
}
