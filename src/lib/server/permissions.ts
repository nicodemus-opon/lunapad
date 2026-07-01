export type UserRole = 'admin' | 'editor' | 'viewer';

export type PermissionAction =
	| 'workspace:read'
	| 'workspace:write'
	| 'connections:query'
	| 'connections:manage'
	| 'shares:publish'
	| 'shares:read'
	| 'comments:read'
	| 'comments:write'
	| 'comments:resolve'
	| 'dbt:run'
	| 'dbt:read'
	| 'admin:manage';

export type CommentAnchorType =
	| 'cell'
	| 'line_range'
	| 'result_row'
	| 'result_cell'
	| 'chart_element'
	| 'gui_stage'
	| 'notebook'
	| 'share_report'
	| 'dbt_test';

export interface PermissionUser {
	id: string;
	role: string | null | undefined;
}

const ROLE_ACTIONS: Record<UserRole, Set<PermissionAction>> = {
	admin: new Set([
		'workspace:read',
		'workspace:write',
		'connections:query',
		'connections:manage',
		'shares:publish',
		'shares:read',
		'comments:read',
		'comments:write',
		'comments:resolve',
		'dbt:run',
		'dbt:read',
		'admin:manage'
	]),
	editor: new Set([
		'workspace:read',
		'workspace:write',
		'connections:query',
		'shares:publish',
		'shares:read',
		'comments:read',
		'comments:write',
		'comments:resolve',
		'dbt:run',
		'dbt:read'
	]),
	viewer: new Set([
		'workspace:read',
		'connections:query',
		'shares:read',
		'comments:read',
		'comments:write',
		'dbt:read'
	])
};

export const ALL_API_SCOPES: PermissionAction[] = [
	'workspace:read',
	'workspace:write',
	'connections:query',
	'connections:manage',
	'shares:publish',
	'shares:read',
	'comments:read',
	'comments:write',
	'comments:resolve',
	'dbt:run',
	'dbt:read'
];

export function normalizeRole(role: string | null | undefined): UserRole {
	if (role === 'admin') return 'admin';
	if (role === 'viewer') return 'viewer';
	// legacy `user` role and unset → editor
	return 'editor';
}

export function can(user: PermissionUser | null, action: PermissionAction): boolean {
	if (!user) return false;
	const role = normalizeRole(user.role);
	return ROLE_ACTIONS[role].has(action);
}

export function canResolveThread(
	user: PermissionUser | null,
	opts: { createdBy: string; assigneeId: string | null }
): boolean {
	if (!user) return false;
	if (can(user, 'comments:resolve')) return true;
	if (user.id === opts.createdBy) return true;
	if (opts.assigneeId === user.id) return true;
	return false;
}

export function canEditComment(
	user: PermissionUser | null,
	authorId: string,
	createdAt: string
): boolean {
	if (!user || user.id !== authorId) return false;
	const ageMs = Date.now() - new Date(createdAt).getTime();
	return ageMs <= 15 * 60 * 1000;
}

export function hasApiScope(
	scopes: string[] | null | undefined,
	action: PermissionAction
): boolean {
	if (!scopes || scopes.length === 0) return true;
	if (scopes.includes('automation:full')) return true;
	return scopes.includes(action);
}

export function userFromLocals(
	user: { id: string; role?: string | null } | null
): PermissionUser | null {
	if (!user) return null;
	return { id: user.id, role: user.role ?? null };
}

export function isUserBanned(
	user: { banned?: boolean | null; banExpires?: Date | null } | null
): boolean {
	if (!user?.banned) return false;
	if (user.banExpires && new Date(user.banExpires) < new Date()) return false;
	return true;
}
