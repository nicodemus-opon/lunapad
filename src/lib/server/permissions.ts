export type UserRole = 'admin' | 'editor' | 'viewer';

export type PermissionAction =
	| 'workspace:read'
	| 'workspace:write'
	| 'connections:query'
	| 'connections:manage'
	| 'shares:publish'
	| 'shares:read'
	| 'sites:manage'
	| 'comments:read'
	| 'comments:write'
	| 'comments:resolve'
	| 'dbt:run'
	| 'dbt:read'
	| 'ai:read'
	| 'ai:mutate'
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
		'sites:manage',
		'comments:read',
		'comments:write',
		'comments:resolve',
		'dbt:run',
		'dbt:read',
		'ai:read',
		'ai:mutate',
		'admin:manage'
	]),
	editor: new Set([
		'workspace:read',
		'workspace:write',
		'connections:query',
		'shares:publish',
		'shares:read',
		'sites:manage',
		'comments:read',
		'comments:write',
		'comments:resolve',
		'dbt:run',
		'dbt:read',
		'ai:read',
		'ai:mutate'
	]),
	viewer: new Set([
		'workspace:read',
		'connections:query',
		'shares:read',
		'comments:read',
		'comments:write',
		'dbt:read',
		'ai:read'
	])
};

export const ALL_API_SCOPES: PermissionAction[] = [
	'workspace:read',
	'workspace:write',
	'connections:query',
	'connections:manage',
	'shares:publish',
	'shares:read',
	'sites:manage',
	'comments:read',
	'comments:write',
	'comments:resolve',
	'dbt:run',
	'dbt:read',
	'ai:read',
	'ai:mutate'
];

/** Tools that mutate notebook state — require ai:mutate permission. */
export const AI_MUTATING_TOOLS = new Set([
	'create_notebook',
	'apply_notebook_patch',
	'run_query_nodes',
	'create_cell',
	'update_cell',
	'delete_cell',
	'run_cells',
	'move_cell',
	'set_chart',
	'pick_chart',
	'set_view_mode'
]);

export function canUseAITool(user: PermissionUser | null, tool: string): boolean {
	if (!user) return false;
	if (AI_MUTATING_TOOLS.has(tool)) return can(user, 'ai:mutate');
	return can(user, 'ai:read');
}

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

/** Actions an unscoped API key (scopes null/empty) is allowed by default.
 *  Historically `hasApiScope` returned true unconditionally for unscoped keys —
 *  fine while MCP/API were read-only, but not once mutating notebook tools exist.
 *  Unscoped keys (including ones already issued before this change) now default
 *  to read-only; write/mutate/run access requires an explicit scope (or the
 *  `automation:full` sentinel) going forward. This is a deliberate breaking
 *  change accepted for the notebook-authoring MCP/API work — see
 *  docs/guide/10-automation-api.md's migration note. */
const READ_ONLY_API_ACTIONS = new Set<PermissionAction>([
	'workspace:read',
	'connections:query',
	'shares:read',
	'comments:read',
	'dbt:read',
	'ai:read'
]);

export function hasApiScope(
	scopes: string[] | null | undefined,
	action: PermissionAction
): boolean {
	if (!scopes || scopes.length === 0) return READ_ONLY_API_ACTIONS.has(action);
	if (scopes.includes('automation:full')) return true;
	return scopes.includes(action);
}

/** MCP tool name -> the PermissionAction it requires. Checked against both the
 *  caller's role (`can`) and, for API-key callers, their key's scopes
 *  (`hasApiScope`) inside createLunapadMcpServer's per-tool handlers — the
 *  hooks.server.ts route-level gate can't do this itself, since it can't parse
 *  which tool a JSON-RPC /api/mcp POST body is calling before dispatch. */
export const MCP_TOOL_ACTIONS: Record<string, PermissionAction> = {
	list_capabilities: 'workspace:read',
	get_visual_report_grammar: 'workspace:read',
	inspect_resource: 'workspace:read',
	discover_schema: 'connections:query',
	validate_workflow: 'workspace:read',
	run_workflow: 'workspace:write',
	delete_resource: 'workspace:write',
	list_connections: 'connections:query',
	run_query: 'connections:query',
	run_prql: 'connections:query',
	list_notebooks: 'workspace:read',
	get_notebook: 'workspace:read',
	inspect_notebook: 'workspace:read',
	validate_notebook: 'workspace:read',
	create_notebook: 'workspace:write',
	apply_notebook_patch: 'workspace:write',
	run_query_nodes: 'workspace:write',
	run_cells: 'workspace:write',
	pick_chart: 'workspace:write',
	set_chart: 'workspace:write',
	dbt_run: 'dbt:run',
	dbt_compile: 'dbt:run',
	get_dbt_job_status: 'dbt:read',
	get_dbt_manifest: 'dbt:read',
	list_shares: 'shares:read',
	publish_notebook: 'shares:publish',
	create_site_page: 'sites:manage',
	search_workspace: 'workspace:read',
	get_lineage: 'workspace:read'
};

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
