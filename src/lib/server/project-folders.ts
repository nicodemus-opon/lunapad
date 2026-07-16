import path from 'node:path';
import { deploymentMode } from './tenancy.js';
import { assertAllowedProjectFolder } from './project.js';

function samePath(a: string, b: string): boolean {
	return path.resolve(a) === path.resolve(b);
}

export function assertTenantProjectFolder(locals: App.Locals, folder: string): string {
	assertAllowedProjectFolder(folder);
	if (deploymentMode() !== 'cloud') return folder;
	const activeFolder = locals.project?.projectFolder;
	if (!activeFolder) {
		throw new Error('The active project does not have a tenant-owned dbt folder.');
	}
	if (!samePath(activeFolder, folder)) {
		throw new Error('Project folder does not belong to the active tenant project.');
	}
	return activeFolder;
}

export function activeTenantProjectFolder(locals: App.Locals): string {
	const folder = locals.project?.projectFolder;
	if (!folder) throw new Error('The active project does not have a dbt folder.');
	return assertTenantProjectFolder(locals, folder);
}
