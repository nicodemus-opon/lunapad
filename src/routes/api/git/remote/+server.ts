import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { isGitRepo, gitSetRemoteUrl, gitRemoveRemoteOrigin } from '$lib/server/git-runner';
import {
	getGitRemoteConfig,
	setGitRemoteConfig,
	deleteGitRemoteConfig
} from '$lib/server/git-remote-config';
import { getGitCredential } from '$lib/server/git-secrets';
import type { GitRemoteInfo } from '$lib/types/git';

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const requestedFolder = url.searchParams.get('folder');
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const ctx = resolveGitTenant(locals, requestedFolder);

		const [config, credential] = await Promise.all([
			getGitRemoteConfig(ctx.projectId, ctx.orgId),
			getGitCredential(ctx.projectId, ctx.orgId)
		]);
		if (!config) return json({ remote: null });

		const info: GitRemoteInfo = {
			remoteUrl: config.remoteUrl,
			defaultBranch: config.defaultBranch,
			authMethod: config.authMethod,
			hasCredential: !!credential,
			publicKey: credential?.authMethod === 'deploy-key' ? credential.publicKey : undefined
		};
		return json({ remote: info });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	try {
		const {
			folder: requestedFolder,
			remoteUrl,
			defaultBranch
		} = (await request.json()) as { folder?: string; remoteUrl?: string; defaultBranch?: string };
		if (!requestedFolder || !remoteUrl?.trim())
			return json({ error: 'folder and remoteUrl are required' }, { status: 400 });
		const ctx = resolveGitTenant(locals, requestedFolder);
		const branch = defaultBranch?.trim() || 'main';

		if (isGitRepo(ctx.folder)) {
			await gitSetRemoteUrl(ctx.folder, remoteUrl);
		}

		const existingConfig = await getGitRemoteConfig(ctx.projectId, ctx.orgId);
		await setGitRemoteConfig(
			ctx.projectId,
			{ remoteUrl, defaultBranch: branch, authMethod: existingConfig?.authMethod ?? null },
			ctx.orgId
		);
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

		if (isGitRepo(ctx.folder)) {
			await gitRemoveRemoteOrigin(ctx.folder);
		}
		await deleteGitRemoteConfig(ctx.projectId, ctx.orgId);
		return json({ ok: true });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
