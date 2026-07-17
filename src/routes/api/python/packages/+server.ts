import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listInstalledPackages,
	installPackage,
	uninstallPackage,
	CURATED_PACKAGES
} from '$lib/server/python-runner';
import { addPinnedPackage, removePinnedPackage } from '$lib/server/python-packages';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

export const GET: RequestHandler = async () => {
	const packages = listInstalledPackages();
	return json({ packages, curated: CURATED_PACKAGES });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { name, folder: requestedFolder } = (await request.json()) as {
		name?: string;
		folder?: string;
	};
	if (typeof name !== 'string' || !name.trim())
		return json({ ok: false, message: 'name is required' }, { status: 400 });

	const result = installPackage(name.trim());
	if (result.ok && requestedFolder) {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		const installed = listInstalledPackages().find(
			(p) => p.name.toLowerCase() === name.trim().toLowerCase()
		);
		await addPinnedPackage(folder, { name: name.trim(), version: installed?.version ?? null });
	}
	return json(result);
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { name, folder: requestedFolder } = (await request.json()) as {
		name?: string;
		folder?: string;
	};
	if (typeof name !== 'string' || !name.trim())
		return json({ ok: false, message: 'name is required' }, { status: 400 });

	const result = uninstallPackage(name.trim());
	if (result.ok && requestedFolder) {
		const folder = assertTenantProjectFolder(locals, requestedFolder);
		await removePinnedPackage(folder, name.trim());
	}
	return json(result);
};
