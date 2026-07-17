import { expect, test, type Page, type Route } from '@playwright/test';
import { installMockBrowserDefaults } from './mock-browser-defaults';

const activeTenant = {
	organization: { id: 'org-1', name: 'Acme Analytics', slug: 'acme', plan: 'team' },
	project: {
		id: 'project-1',
		name: 'Warehouse Models',
		slug: 'warehouse-models',
		projectFolder: null,
		archivedAt: null
	},
	membership: { role: 'admin' as const }
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
	await route.fulfill({
		status,
		contentType: 'application/json',
		body: JSON.stringify(body)
	});
}

async function installSaasMocks(page: Page) {
	await page.route('**/api/setup', async (route) => {
		if (route.request().method() === 'POST') {
			await fulfillJson(route, {
				user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
				...activeTenant
			});
			return;
		}
		await fulfillJson(route, { needsSetup: false, mode: 'closed' });
	});
	await page.route('**/api/workspace/load', async (route) => {
		await fulfillJson(route, { data: null, updatedAt: null, updatedBy: null });
	});
	await page.route('**/api/workspace/save', async (route) => {
		await fulfillJson(route, { updatedAt: new Date().toISOString(), updatedBy: null });
	});
	await page.route('**/api/orgs/current', async (route) => {
		await fulfillJson(route, activeTenant);
	});
	await page.route('**/api/orgs', async (route) => {
		await fulfillJson(route, {
			organizations: [
				{
					organization: activeTenant.organization,
					membership: activeTenant.membership,
					projects: [activeTenant.project],
					activeProject: activeTenant.project
				}
			],
			activeOrgId: activeTenant.organization.id,
			activeProjectId: activeTenant.project.id
		});
	});
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() === 'POST') {
			await fulfillJson(route, {
				project: {
					id: 'project-2',
					name: 'New project',
					slug: 'new-project',
					projectFolder: null,
					archivedAt: null
				}
			});
			return;
		}
		await fulfillJson(route, { projects: [activeTenant.project], activeProjectId: activeTenant.project.id });
	});
	await page.route('**/api/team/users', async (route) => {
		await fulfillJson(route, {
			users: [
				{
					id: 'user-1',
					name: 'Owner',
					email: 'owner@example.com',
					role: 'admin',
					mention: 'owner'
				}
			]
		});
	});
	await page.route('**/api/invitations', async (route) => {
		if (route.request().method() === 'POST') {
			await fulfillJson(route, {
				invitation: {
					id: 'invite-1',
					email: 'analyst@example.com',
					role: 'editor',
					token: 'invite-token',
					expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
					acceptedAt: null,
					acceptedBy: null,
					revokedAt: null
				}
			});
			return;
		}
		await fulfillJson(route, {
			invitations: [
				{
					id: 'invite-1',
					email: 'analyst@example.com',
					role: 'editor',
					token: 'invite-token',
					expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
					acceptedAt: null,
					acceptedBy: null,
					revokedAt: null
				}
			]
		});
	});
	await page.route('**/api/account/sessions', async (route) => {
		await fulfillJson(route, {
			sessions: [
				{
					id: 'session-1',
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					expiresAt: null,
					ipAddress: '127.0.0.1',
					userAgent: 'Playwright',
					current: true
				}
			]
		});
	});
	await page.route('**/api/usage', async (route) => {
		await fulfillJson(route, {
			usage: {
				plan: 'team',
				limits: {
					maxProjects: 10,
					maxExternalConnections: 5,
					maxPublishedShares: 20,
					maxSchedules: 10,
					maxConcurrentJobs: 3,
					monthlyAiTokens: 100000,
					maxStorageMb: 1024
				},
				usage: {
					projects: 1,
					externalConnections: 0,
					publishedShares: 0,
					scheduledJobs: 0,
					apiKeys: 0,
					activeJobs: 0,
					aiTokens: 0,
					storageMb: 1
				}
			}
		});
	});
	await page.route('**/api/jobs*', async (route) => {
		await fulfillJson(route, { jobs: [] });
	});
	await page.route('**/api/onboarding/checklist', async (route) => {
		await fulfillJson(route, {
			items: [
				{
					id: 'invite-team',
					label: 'Invite your team',
					description: 'Add teammates to review notebooks and reports.',
					done: false,
					dismissed: false,
					actionHref: '#',
					actionLabel: 'Open team'
				}
			]
		});
	});
	await page.route('**/api/connections', async (route) => {
		await fulfillJson(route, { connections: [] });
	});
	await installMockBrowserDefaults(page);
}

async function openWorkspace(page: Page) {
	await installSaasMocks(page);
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'New notebook' }).first()).toBeVisible({
		timeout: 60_000
	});
}

test.describe('SaaS product flows', () => {
	test('setup preserves redirect and creates the workspace', async ({ page }) => {
		await page.route('**/api/setup', async (route) => {
			if (route.request().method() === 'POST') {
				await fulfillJson(route, {
					user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
					...activeTenant
				});
				return;
			}
			await fulfillJson(route, { needsSetup: true, mode: 'fresh' });
		});
		await page.goto('/setup?redirectTo=%2Finvite%2Finvite-token');
		await page.getByLabel('Workspace name').fill('Acme Analytics');
		await page.getByLabel('Starter project').fill('Warehouse Models');
		await page.getByLabel('Name', { exact: true }).fill('Owner');
		await page.getByLabel('Email', { exact: true }).fill('owner@example.com');
		await page.getByLabel('Password', { exact: true }).fill('password123');
		await page.getByLabel('Confirm password', { exact: true }).fill('password123');
		await page.getByRole('button', { name: 'Create workspace' }).click();
		await expect(page).toHaveURL(/\/invite\/invite-token$/);
	});

	test('settings exposes team, usage, jobs, and account states', async ({ page }) => {
		await openWorkspace(page);
		await page.getByLabel('Account menu').click();
		await page.getByRole('menuitem', { name: /Admin/ }).click();
		await expect(page.locator('h1', { hasText: /^Team$/ })).toBeVisible();
		await expect(page.getByText('owner@example.com')).toBeVisible();
		await expect(page.getByText('analyst@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Usage' }).click();
  await expect(page.getByText('team plan')).toBeVisible();
  await expect(page.getByRole('table').getByText('Projects')).toBeVisible();

		await page.getByRole('button', { name: 'Jobs' }).click();
		await expect(page.getByText('No jobs yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Account', exact: true }).click();
		await expect(page.getByText('Current session')).toBeVisible();
	});

	test('project switcher validates create project input', async ({ page }) => {
		await openWorkspace(page);
		await page.getByTestId('project-switcher').click();
		await page.getByRole('menuitem', { name: 'Create project' }).click();
		await expect(page.getByTestId('project-dialog')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
		await page.getByLabel('Project name').fill('New project');
		await expect(page.getByRole('button', { name: 'Create project' })).toBeEnabled();
	});
});
