import { assertTenantProjectFolder } from './project-folders.js';
import { DEFAULT_ORG_ID, DEFAULT_PROJECT_ID } from './tenancy.js';
import { getGitCredential, type GitCredentialSecret } from './git-secrets.js';

export interface GitRequestContext {
	folder: string;
	orgId: string;
	projectId: string;
}

/** Resolves the tenant-scoped project folder + org/project ids a git route should act on. */
export function resolveGitTenant(locals: App.Locals, requestedFolder: string): GitRequestContext {
	const folder = assertTenantProjectFolder(locals, requestedFolder);
	const orgId = locals.organization?.id ?? DEFAULT_ORG_ID;
	const projectId = locals.project?.id ?? DEFAULT_PROJECT_ID;
	return { folder, orgId, projectId };
}

export function resolveGitCredential(ctx: GitRequestContext): Promise<GitCredentialSecret | null> {
	return getGitCredential(ctx.projectId, ctx.orgId);
}
