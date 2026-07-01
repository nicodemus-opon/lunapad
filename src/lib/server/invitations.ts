import crypto from 'node:crypto';
import { query } from './db.js';
import type { UserRole } from './permissions.js';

let invitationsTableReady: Promise<void> | null = null;

export interface Invitation {
	id: string;
	email: string;
	role: UserRole;
	token: string;
	createdBy: string;
	createdAt: string;
	expiresAt: string;
	acceptedAt: string | null;
}

async function ensureInvitationsTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS invitations (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email       TEXT NOT NULL,
			role        TEXT NOT NULL DEFAULT 'editor',
			token       TEXT NOT NULL UNIQUE,
			created_by  TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			expires_at  TIMESTAMPTZ NOT NULL,
			accepted_at TIMESTAMPTZ
		)
	`);
	await query(`CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (email)`);
}

export function ensureInvitationsTableOnce(): Promise<void> {
	if (!invitationsTableReady) invitationsTableReady = ensureInvitationsTable();
	return invitationsTableReady;
}

function toInvitation(row: {
	id: string;
	email: string;
	role: string;
	token: string;
	created_by: string;
	created_at: string;
	expires_at: string;
	accepted_at: string | null;
}): Invitation {
	return {
		id: row.id,
		email: row.email,
		role: row.role as UserRole,
		token: row.token,
		createdBy: row.created_by,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		acceptedAt: row.accepted_at
	};
}

export async function createInvitation(input: {
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
		email: string;
		role: string;
		token: string;
		created_by: string;
		created_at: string;
		expires_at: string;
		accepted_at: string | null;
	}>(
		`INSERT INTO invitations (email, role, token, created_by, expires_at)
		 VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)
		 RETURNING id, email, role, token, created_by, created_at, expires_at, accepted_at`,
		[input.email.toLowerCase().trim(), input.role, token, input.createdBy, String(expiresInDays)]
	);
	return toInvitation(rows[0]);
}

export async function listPendingInvitations(): Promise<Invitation[]> {
	await ensureInvitationsTableOnce();
	const rows = await query<{
		id: string;
		email: string;
		role: string;
		token: string;
		created_by: string;
		created_at: string;
		expires_at: string;
		accepted_at: string | null;
	}>(
		`SELECT id, email, role, token, created_by, created_at, expires_at, accepted_at
		 FROM invitations
		 WHERE accepted_at IS NULL AND expires_at > now()
		 ORDER BY created_at DESC`
	);
	return rows.map(toInvitation);
}

export async function getInvitationByToken(token: string): Promise<Invitation | null> {
	await ensureInvitationsTableOnce();
	const rows = await query<{
		id: string;
		email: string;
		role: string;
		token: string;
		created_by: string;
		created_at: string;
		expires_at: string;
		accepted_at: string | null;
	}>(
		`SELECT id, email, role, token, created_by, created_at, expires_at, accepted_at
		 FROM invitations WHERE token = $1`,
		[token]
	);
	const row = rows[0];
	if (!row || row.accepted_at) return null;
	if (new Date(row.expires_at) < new Date()) return null;
	return toInvitation(row);
}

export async function markInvitationAccepted(token: string): Promise<void> {
	await ensureInvitationsTableOnce();
	await query(`UPDATE invitations SET accepted_at = now() WHERE token = $1`, [token]);
}

export async function revokeInvitation(id: string): Promise<void> {
	await ensureInvitationsTableOnce();
	await query(`DELETE FROM invitations WHERE id = $1 AND accepted_at IS NULL`, [id]);
}
