import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sshpk from 'sshpk';
import { resolveGitTenant } from '$lib/server/git-tenant';
import { setGitCredential } from '$lib/server/git-secrets';
import { getGitRemoteConfig, setGitRemoteConfig } from '$lib/server/git-remote-config';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { folder: requestedFolder } = (await request.json()) as { folder?: string };
		if (!requestedFolder) return json({ error: 'folder is required' }, { status: 400 });
		const ctx = resolveGitTenant(locals, requestedFolder);

		const key = sshpk.generatePrivateKey('ed25519');
		// Genuine OpenSSH private-key format (`-----BEGIN OPENSSH PRIVATE KEY-----`) —
		// what `ssh -i` actually expects, not a generic PKCS8 PEM we'd be hoping it accepts.
		const privateKey = key.toString('openssh');
		const publicKeyComment = key.toPublic();
		publicKeyComment.comment = 'lunapad-deploy-key';
		const publicKey = publicKeyComment.toString('ssh');

		await setGitCredential(
			ctx.projectId,
			{ authMethod: 'deploy-key', privateKey, publicKey },
			ctx.orgId
		);

		const existingConfig = await getGitRemoteConfig(ctx.projectId, ctx.orgId);
		if (existingConfig) {
			await setGitRemoteConfig(
				ctx.projectId,
				{ ...existingConfig, authMethod: 'deploy-key' },
				ctx.orgId
			);
		}

		return json({ publicKey });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
