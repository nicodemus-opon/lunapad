import crypto from 'node:crypto';
import { query } from './db.js';
import type { UserRole } from './permissions.js';
import { DEFAULT_ORG_ID, ensureDefaultTenant } from './tenancy.js';

let invitationsTableReady: Promise<void> | null = null;

export interface Invitation {
	id: string;
	orgId: string;
	email: string;
	role: UserRole;
	token: string;
	createdBy: string;
	createdAt: string;
	expiresAt: string;
	acceptedAt: string | null;
	acceptedBy: string | null;
	revokedAt: string | null;
}

export type InviteAcceptState =
	| 'pending'
	| 'accepted'
	| 'expired'
	| 'revoked'
	| 'login_required'
	| 'wrong_email';

async function ensureInvitationsTable(): Promise<void> {
	await ensureDefaultTenant();
	await query(`
		CREATE TABLE IF NOT EXISTS invitations (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			org_id      TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			email       TEXT NOT NULL,
			role        TEXT NOT NULL DEFAULT 'editor',
			token       TEXT NOT NULL UNIQUE,
			created_by  TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			expires_at  TIMESTAMPTZ NOT NULL,
			accepted_at TIMESTAMPTZ,
			accepted_by TEXT REFERENCES "user"("id") ON DELETE SET NULL,
			revoked_at  TIMESTAMPTZ
		)
	`);
	await query(
		`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
	);
	await query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS accepted_by TEXT`);
	await query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`);
	await query(`CREATE INDEX IF NOT EXISTS invitations_org_idx ON invitations (org_id)`);
	await query(`CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (email)`);
}

export function ensureInvitationsTableOnce(): Promise<void> {
	if (!invitationsTableReady) invitationsTableReady = ensureInvitationsTable();
	return invitationsTableReady;
}

function toInvitation(row: {
	id: string;
	org_id: string;
	email: string;
	role: string;
	token: string;
	created_by: string;
	created_at: string;
	expires_at: string;
	accepted_at: string | null;
	accepted_by: string | null;
	revoked_at: string | null;
}): Invitation {
	return {
		id: row.id,
		orgId: row.org_id,
		email: row.email,
		role: row.role as UserRole,
		token: row.token,
		createdBy: row.created_by,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		acceptedAt: row.accepted_at,
		acceptedBy: row.accepted_by,
		revokedAt: row.revoked_at
	};
}

export async function createInvitation(input: {
	orgId?: string | null;
	email: string;
	role: UserRole;
	createdBy: string;
	expiresInDays?: number;
}): Promise<Invitation> {
	await ensureInvitationsTableOnce();
	const token = crypto.randomBytes(24).toString('hex');
	const expiresInDays = input.expiresInDays ?? 7;
	const rows = await query<{
		id: string;
		org_id: string;
		email: string;
		role: string;
		token: string;
		created_by: string;
		created_at: string;
		expires_at: string;
		accepted_at: string | null;
		accepted_by: string | null;
		revoked_at: string | null;
	}>(
		`INSERT INTO invitations (org_id, email, role, token, created_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)
		 RETURNING id, org_id, email, role, token, created_by, created_at, expires_at,
		           accepted_at, accepted_by, revoked_at`,
		[
			input.orgId ?? DEFAULT_ORG_ID,
			input.email.toLowerCase().trim(),
			input.role,
			token,
			input.createdBy,
			String(expiresInDays)
		]
	);
	return toInvitation(rows[0]);
}

export async function listPendingInvitations(orgId = DEFAULT_ORG_ID): Promise<Invitation[]> {
	return listOrganizationInvitations(orgId, { pendingOnly: true });
}

export async function listOrganizationInvitations(
	orgId = DEFAULT_ORG_ID,
	opts: { pendingOnly?: boolean } = {}
): Promise<Invitation[]> {
	await ensureInvitationsTableOnce();
	const rows = await query<{
		id: string;
		org_id: string;
		email: string;
		role: string;
		token: string;
		created_by: string;
		created_at: string;
		expires_at: string;
		accepted_at: string | null;
		accepted_by: string | null;
		revoked_at: string | null;
	}>(
		`SELECT id, org_id, email, role, token, created_by, created_at, expires_at,
		        accepted_at, accepted_by, revoked_at
		 FROM invitations
		 WHERE org_id = $1
		   AND (
		     $2::boolean = false
		     OR (accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
		   )
		 ORDER BY created_at DESC`,
		[orgId, opts.pendingOnly === true]
	);
	return rows.map(toInvitation);
}

export async function getInvitationRecordByToken(token: string): Promise<Invitation | null> {
	await ensureInvitationsTableOnce();
	const rows = await query<{
		id: string;
		org_id: string;
		email: string;
		role: string;
		token: string;
		created_by: string;
		created_at: string;
		expires_at: string;
		accepted_at: string | null;
		accepted_by: string | null;
		revoked_at: string | null;
	}>(
		`SELECT id, org_id, email, role, token, created_by, created_at, expires_at,
		        accepted_at, accepted_by, revoked_at
		 FROM invitations WHERE token = $1`,
		[token]
	);
	const row = rows[0];
	return row ? toInvitation(row) : null;
}

export function invitationState(invitation: Invitation): InviteAcceptState {
	if (invitation.revokedAt) return 'revoked';
	if (invitation.acceptedAt) return 'accepted';
	if (new Date(invitation.expiresAt) < new Date()) return 'expired';
	return 'pending';
}

export async function getInvitationByToken(token: string): Promise<Invitation | null> {
	const invitation = await getInvitationRecordByToken(token);
	if (!invitation || invitationState(invitation) !== 'pending') return null;
	return invitation;
}

export async function markInvitationAccepted(
	token: string,
	userId: string
): Promise<Invitation | null> {
	await ensureInvitationsTableOnce();
	const rows = await query<{
		id: string;
		org_id: string;
		email: string;
		role: string;
		token: string;
		created_by: string;
		created_at: string;
		expires_at: string;
		accepted_at: string | null;
		accepted_by: string | null;
		revoked_at: string | null;
	}>(
		`UPDATE invitations
		 SET accepted_at = now(), accepted_by = $2
		 WHERE token = $1
		   AND accepted_at IS NULL
		   AND revoked_at IS NULL
		   AND expires_at > now()
		 RETURNING id, org_id, email, role, token, created_by, created_at, expires_at,
		           accepted_at, accepted_by, revoked_at`,
		[token, userId]
	);
	return rows[0] ? toInvitation(rows[0]) : null;
}

export async function revokeInvitation(id: string, orgId = DEFAULT_ORG_ID): Promise<void> {
	await ensureInvitationsTableOnce();
	await query(`UPDATE invitations SET revoked_at = now() WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL`, [
		id,
		orgId
	]);
}
