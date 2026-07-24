import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { gitLsRemote } from '$lib/server/git-runner';
import { setGitCredential, deleteGitCredential } from '$lib/server/git-secrets';
import { getGitRemoteConfig, setGitRemoteConfig } from '$lib/server/git-remote-config';
import type { GitCredentialSecret } from '$lib/server/git-secrets';

/** Tests a credential against the configured remote before it's persisted, mirroring
 *  ConnectionsSettings' test-then-save flow for external DB connections. */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			folder: requestedFolder,
			authMethod,
			token,
			username
		} = (await request.json()) as {
			folder?: string;
			authMethod?: 'pat';
			token?: string;
			username?: string;
		};
		if (!requestedFolder || authMethod !== 'pat' || !token?.trim())
			return json({ error: 'folder, authMethod, and token are required' }, { status: 400 });
		const ctx = resolveGitTenant(locals, requestedFolder);

		const config = await getGitRemoteConfig(ctx.projectId, ctx.orgId);
		if (!config)
			return json({ error: 'Set a remote URL before adding a credential' }, { status: 400 });

		const credential: GitCredentialSecret = { authMethod: 'pat', token, username };
		const test = await gitLsRemote(ctx.folder, config.remoteUrl, credential);
		if (!test.ok) {
			return json(
				{ error: test.message || 'Could not authenticate against the remote with this token' },
				{ status: 400 }
			);
		}

		await setGitCredential(ctx.projectId, credential, ctx.orgId);
		await setGitRemoteConfig(ctx.projectId, { ...config, authMethod: 'pat' }, ctx.orgId);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder } = (await request.json()) as { folder?: string };
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const ctx = resolveGitTenant(locals, requestedFolder);

		await deleteGitCredential(ctx.projectId, ctx.orgId);
		const config = await getGitRemoteConfig(ctx.projectId, ctx.orgId);
		if (config) await setGitRemoteConfig(ctx.projectId, { ...config, authMethod: null }, ctx.orgId);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
