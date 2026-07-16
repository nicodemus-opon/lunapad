import crypto from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { auth, ensureAuthTablesOnce } from './auth.js';
import { getPool, query } from './db.js';
import {
	deploymentMode,
	ensureTenantTablesOnce,
	projectFolderFor,
	ensureProjectScaffold,
	entitlementsForPlan,
	type DeploymentMode,
	type Organization,
	type OrganizationMembership,
	type Project,
	type TenantContext
} from './tenancy.js';

export type SetupMode = 'fresh' | 'repair' | 'closed';

export interface SetupStatus {
	mode: SetupMode;
	deploymentMode: DeploymentMode;
	hasUsers: boolean;
	hasOrganizations: boolean;
	hasProjects: boolean;
	hasAdminMembership: boolean;
	repairReason?: string;
}

interface SetupInput {
	name: string;
	email: string;
	password: string;
	workspaceName: string;
	projectName: string;
	headers: Headers;
}

export interface SignupInput {
	name: string;
	email: string;
	password: string;
	workspaceName: string;
	projectName: string;
	headers: Headers;
}

export interface CreatedAccount {
	id: string;
	name: string;
	email: string;
}

function slugify(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'workspace';
}

function dbtName(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 48);
	return slug || 'lunapad_project';
}

async function countTable(table: string): Promise<number> {
	const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
	return Number(rows[0]?.count ?? 0);
}

export async function getSetupStatus(): Promise<SetupStatus> {
	await ensureAuthTablesOnce();
	await ensureTenantTablesOnce();
	const [userCount, orgCount, projectCount, adminRows] = await Promise.all([
		countTable('"user"'),
		countTable('organizations'),
		countTable('projects'),
		query<{ id: string }>(
			`SELECT m.user_id AS id
			 FROM organization_members m
			 JOIN organizations o ON o.id = m.org_id
			 JOIN projects p ON p.org_id = o.id AND p.archived_at IS NULL
			 WHERE m.role = 'admin'
			 LIMIT 1`
		)
	]);
	const hasUsers = userCount > 0;
	const hasOrganizations = orgCount > 0;
	const hasProjects = projectCount > 0;
	const hasAdminMembership = adminRows.length > 0;
	if (!hasUsers) {
		return {
			mode: 'fresh',
			deploymentMode: deploymentMode(),
			hasUsers,
			hasOrganizations,
			hasProjects,
			hasAdminMembership
		};
	}
	if (hasOrganizations && hasProjects && hasAdminMembership) {
		return {
			mode: 'closed',
			deploymentMode: deploymentMode(),
			hasUsers,
			hasOrganizations,
			hasProjects,
			hasAdminMembership
		};
	}
	return {
		mode: 'repair',
		deploymentMode: deploymentMode(),
		hasUsers,
		hasOrganizations,
		hasProjects,
		hasAdminMembership,
		repairReason: 'A user exists, but the initial workspace/project tenant is incomplete.'
	};
}

async function uniqueOrgSlug(baseName: string): Promise<string> {
	const base = slugify(baseName);
	for (let i = 0; ; i++) {
		const slug = i === 0 ? base : `${base}-${i + 1}`;
		const rows = await query<{ id: string }>(`SELECT id FROM organizations WHERE slug = $1 LIMIT 1`, [
			slug
		]);
		if (rows.length === 0) return slug;
	}
}

async function uniqueProjectSlug(orgId: string, baseName: string): Promise<string> {
	const base = slugify(baseName);
	for (let i = 0; ; i++) {
		const slug = i === 0 ? base : `${base}-${i + 1}`;
		const rows = await query<{ id: string }>(
			`SELECT id FROM projects WHERE org_id = $1 AND slug = $2 LIMIT 1`,
			[orgId, slug]
		);
		if (rows.length === 0) return slug;
	}
}

function tenantFromRows(input: {
	organization: Organization;
	project: Project;
	membership: OrganizationMembership;
}): TenantContext {
	return {
		...input,
		entitlements: entitlementsForPlan(input.organization.plan)
	};
}

async function signIn(email: string, password: string, headers: Headers) {
	return auth.api.signInEmail({
		body: { email, password, rememberMe: true },
		headers
	});
}

async function assertEmailAvailable(email: string): Promise<void> {
	const existing = await query<{ id: string }>(
		`SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1`,
		[email]
	);
	if (existing.length > 0) throw new Error('An account already exists for this email.');
}

export async function createPasswordAccount(input: {
	name: string;
	email: string;
	password: string;
	role?: 'admin' | 'editor' | 'viewer';
}): Promise<CreatedAccount> {
	await ensureAuthTablesOnce();
	const email = input.email.trim().toLowerCase();
	const name = input.name.trim() || email.split('@')[0];
	if (!email || !input.password) throw new Error('Email and password are required.');
	await assertEmailAvailable(email);
	const userId = crypto.randomUUID();
	const passwordHash = await hashPassword(input.password);
	await query(
		`INSERT INTO "user" (id, name, email, "emailVerified", role)
		 VALUES ($1, $2, $3, false, $4)`,
		[userId, name, email, input.role ?? 'editor']
	);
	await query(
		`INSERT INTO account (id, "accountId", "providerId", "userId", password)
		 VALUES ($1, $2, 'credential', $2, $3)`,
		[crypto.randomUUID(), userId, passwordHash]
	);
	return { id: userId, name, email };
}

export async function completeCloudSignup(input: SignupInput): Promise<{
	user: CreatedAccount;
	tenant: TenantContext;
}> {
	await ensureAuthTablesOnce();
	await ensureTenantTablesOnce();
	if (deploymentMode() !== 'cloud') {
		throw new Error('Cloud signup is only available in cloud deployment mode.');
	}
	const email = input.email.trim().toLowerCase();
	const name = input.name.trim();
	const workspaceName = input.workspaceName.trim();
	const projectName = input.projectName.trim();
	if (!name || !email || !input.password || !workspaceName || !projectName) {
		throw new Error('Name, email, password, workspace name, and project name are required.');
	}
	await assertEmailAvailable(email);

	const userId = crypto.randomUUID();
	const orgId = crypto.randomUUID();
	const projectId = crypto.randomUUID();
	const orgSlug = await uniqueOrgSlug(workspaceName);
	const projectSlug = await uniqueProjectSlug(orgId, projectName);
	const projectFolder = projectFolderFor(orgId, projectId);
	await ensureProjectScaffold({ name: dbtName(projectName), projectFolder });
	const passwordHash = await hashPassword(input.password);

	const pool = getPool();
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query(
			`INSERT INTO "user" (id, name, email, "emailVerified", role)
			 VALUES ($1, $2, $3, false, 'admin')`,
			[userId, name, email]
		);
		await client.query(
			`INSERT INTO account (id, "accountId", "providerId", "userId", password)
			 VALUES ($1, $2, 'credential', $2, $3)`,
			[crypto.randomUUID(), userId, passwordHash]
		);
		await client.query(`INSERT INTO organizations (id, name, slug, plan) VALUES ($1, $2, $3, 'free')`, [
			orgId,
			workspaceName,
			orgSlug
		]);
		await client.query(
			`INSERT INTO projects (id, org_id, name, slug, project_folder)
			 VALUES ($1, $2, $3, $4, $5)`,
			[projectId, orgId, projectName, projectSlug, projectFolder]
		);
		await client.query(
			`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
			[orgId, userId]
		);
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw err;
	} finally {
		client.release();
	}

	await signIn(email, input.password, input.headers);
	const tenant = await createTenantForExistingUser({
		userId,
		userName: name,
		workspaceName,
		projectName,
		existingOrgId: orgId,
		existingProjectId: projectId
	});
	return { user: { id: userId, name, email }, tenant };
}

export async function completeInitialSetup(input: SetupInput): Promise<{
	user: { id: string; name: string; email: string };
	tenant: TenantContext;
}> {
	const status = await getSetupStatus();
	if (status.mode === 'closed') throw new Error('Setup is already complete.');

	const email = input.email.trim().toLowerCase();
	const name = input.name.trim();
	const workspaceName = input.workspaceName.trim();
	const projectName = input.projectName.trim();
	if (!name || !email || !input.password || !workspaceName || !projectName) {
		throw new Error('Name, email, password, workspace name, and project name are required.');
	}

	if (status.mode === 'repair') {
		const signedIn = await signIn(email, input.password, input.headers);
		const user = signedIn.user;
		const tenant = await createTenantForExistingUser({
			userId: user.id,
			userName: user.name,
			workspaceName,
			projectName
		});
		return { user: { id: user.id, name: user.name, email: user.email }, tenant };
	}

	const pool = getPool();
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query(`SELECT pg_advisory_xact_lock(hashtext('lunapad_initial_setup'))`);
		const existingUsers = await client.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM "user"`
		);
		if (Number(existingUsers.rows[0]?.count ?? 0) > 0) {
			throw new Error('Setup changed while you were submitting. Refresh and try again.');
		}

		const userId = crypto.randomUUID();
		const orgId = crypto.randomUUID();
		const projectId = crypto.randomUUID();
		const orgSlug = await uniqueOrgSlug(workspaceName);
		const projectSlug = await uniqueProjectSlug(orgId, projectName);
		const projectFolder = projectFolderFor(orgId, projectId);
		await ensureProjectScaffold({ name: dbtName(projectName), projectFolder });
		const passwordHash = await hashPassword(input.password);

		await client.query(
			`INSERT INTO "user" (id, name, email, "emailVerified", role)
			 VALUES ($1, $2, $3, false, 'admin')`,
			[userId, name, email]
		);
		await client.query(
			`INSERT INTO account (id, "accountId", "providerId", "userId", password)
			 VALUES ($1, $2, 'credential', $2, $3)`,
			[crypto.randomUUID(), userId, passwordHash]
		);
		await client.query(`INSERT INTO organizations (id, name, slug, plan) VALUES ($1, $2, $3, 'team')`, [
			orgId,
			workspaceName,
			orgSlug
		]);
		await client.query(
			`INSERT INTO projects (id, org_id, name, slug, project_folder)
			 VALUES ($1, $2, $3, $4, $5)`,
			[projectId, orgId, projectName, projectSlug, projectFolder]
		);
		await client.query(
			`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
			[orgId, userId]
		);
		await client.query('COMMIT');

		await signIn(email, input.password, input.headers);
		const tenant = await createTenantForExistingUser({
			userId,
			userName: name,
			workspaceName,
			projectName,
			existingOrgId: orgId,
			existingProjectId: projectId
		});
		return { user: { id: userId, name, email }, tenant };
	} catch (err) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw err;
	} finally {
		client.release();
	}
}

async function createTenantForExistingUser(input: {
	userId: string;
	userName: string;
	workspaceName: string;
	projectName: string;
	existingOrgId?: string;
	existingProjectId?: string;
}): Promise<TenantContext> {
	await ensureTenantTablesOnce();
	const existingRows = await query<{
		organization_id: string;
		organization_name: string;
		organization_slug: string;
		organization_plan: string;
		organization_created_at: string;
		organization_updated_at: string;
		project_id: string;
		project_org_id: string;
		project_name: string;
		project_slug: string;
		project_folder: string | null;
		project_archived_at: string | null;
		project_created_at: string;
		project_updated_at: string;
		membership_role: string;
		membership_created_at: string;
		membership_updated_at: string;
	}>(
		`SELECT o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug,
		        o.plan AS organization_plan, o.created_at AS organization_created_at,
		        o.updated_at AS organization_updated_at,
		        p.id AS project_id, p.org_id AS project_org_id, p.name AS project_name,
		        p.slug AS project_slug, p.project_folder, p.archived_at AS project_archived_at,
		        p.created_at AS project_created_at, p.updated_at AS project_updated_at,
		        m.role AS membership_role, m.created_at AS membership_created_at,
		        m.updated_at AS membership_updated_at
		 FROM organization_members m
		 JOIN organizations o ON o.id = m.org_id
		 JOIN projects p ON p.org_id = o.id AND p.archived_at IS NULL
		 WHERE m.user_id = $1 AND m.role = 'admin'
		 ORDER BY o.created_at ASC, p.created_at ASC
		 LIMIT 1`,
		[input.userId]
	);
	const existing = existingRows[0];
	if (existing) {
		return tenantFromRows({
			organization: {
				id: existing.organization_id,
				name: existing.organization_name,
				slug: existing.organization_slug,
				plan: existing.organization_plan as Organization['plan'],
				createdAt: existing.organization_created_at,
				updatedAt: existing.organization_updated_at
			},
			project: {
				id: existing.project_id,
				orgId: existing.project_org_id,
				name: existing.project_name,
				slug: existing.project_slug,
				projectFolder: existing.project_folder,
				archivedAt: existing.project_archived_at,
				createdAt: existing.project_created_at,
				updatedAt: existing.project_updated_at
			},
			membership: {
				orgId: existing.organization_id,
				userId: input.userId,
				role: existing.membership_role as OrganizationMembership['role'],
				createdAt: existing.membership_created_at,
				updatedAt: existing.membership_updated_at
			}
		});
	}

	const orgId = input.existingOrgId ?? crypto.randomUUID();
	const projectId = input.existingProjectId ?? crypto.randomUUID();
	const orgSlug = await uniqueOrgSlug(input.workspaceName);
	const projectSlug = await uniqueProjectSlug(orgId, input.projectName);
	const projectFolder = projectFolderFor(orgId, projectId);
	await ensureProjectScaffold({ name: dbtName(input.projectName), projectFolder });
	const pool = getPool();
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		await client.query(`SELECT pg_advisory_xact_lock(hashtext('lunapad_initial_setup'))`);
		await client.query(
			`INSERT INTO organizations (id, name, slug, plan)
			 VALUES ($1, $2, $3, 'team')
			 ON CONFLICT (id) DO NOTHING`,
			[orgId, input.workspaceName, orgSlug]
		);
		await client.query(
			`INSERT INTO projects (id, org_id, name, slug, project_folder)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (id) DO NOTHING`,
			[projectId, orgId, input.projectName, projectSlug, projectFolder]
		);
		await client.query(
			`INSERT INTO organization_members (org_id, user_id, role)
			 VALUES ($1, $2, 'admin')
			 ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'admin', updated_at = now()`,
			[orgId, input.userId]
		);
		await client.query('COMMIT');
	} catch (err) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw err;
	} finally {
		client.release();
	}
	const statusRows = await query<{
		id: string;
		name: string;
		slug: string;
		plan: string;
		created_at: string;
		updated_at: string;
	}>(
		`SELECT id, name, slug, plan, created_at, updated_at FROM organizations WHERE id = $1`,
		[orgId]
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
		`SELECT id, org_id, name, slug, project_folder, archived_at, created_at, updated_at
		 FROM projects WHERE id = $1`,
		[projectId]
	);
	const membershipRows = await query<{
		org_id: string;
		user_id: string;
		role: string;
		created_at: string;
		updated_at: string;
	}>(
		`SELECT org_id, user_id, role, created_at, updated_at
		 FROM organization_members WHERE org_id = $1 AND user_id = $2`,
		[orgId, input.userId]
	);
	return tenantFromRows({
		organization: {
			id: statusRows[0].id,
			name: statusRows[0].name,
			slug: statusRows[0].slug,
			plan: statusRows[0].plan as Organization['plan'],
			createdAt: statusRows[0].created_at,
			updatedAt: statusRows[0].updated_at
		},
		project: {
			id: projectRows[0].id,
			orgId: projectRows[0].org_id,
			name: projectRows[0].name,
			slug: projectRows[0].slug,
			projectFolder: projectRows[0].project_folder,
			archivedAt: projectRows[0].archived_at,
			createdAt: projectRows[0].created_at,
			updatedAt: projectRows[0].updated_at
		},
		membership: {
			orgId: membershipRows[0].org_id,
			userId: membershipRows[0].user_id,
			role: membershipRows[0].role as OrganizationMembership['role'],
			createdAt: membershipRows[0].created_at,
			updatedAt: membershipRows[0].updated_at
		}
	});
}
