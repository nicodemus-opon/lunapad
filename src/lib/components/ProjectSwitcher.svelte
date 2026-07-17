<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { emitProjectChange } from '$lib/stores/project-context';
	import { flushPendingSave, clearWorkspaceCache } from '$lib/stores/notebook.svelte';
	import { toast } from 'svelte-sonner';
	import {
		Archive,
		Check,
		ChevronsUpDown,
		FolderKanban,
		LogOut,
		Pencil,
		Plus,
		Users
	} from '@lucide/svelte';

	type Role = 'admin' | 'editor' | 'viewer';
	type ProjectSummary = {
		id: string;
		name: string;
		slug: string;
		projectFolder?: string | null;
		archivedAt: string | null;
	};
	type OrganizationSummary = { id: string; name: string; slug: string; plan: string };
	type CurrentOrg = {
		organization: OrganizationSummary;
		project: ProjectSummary;
		membership: { role: Role };
	};
	type OrganizationListItem = {
		organization: OrganizationSummary;
		membership: { role: Role };
		projects: ProjectSummary[];
		activeProject: ProjectSummary | null;
	};
	type SwitcherState = {
		organizations: OrganizationListItem[];
		activeOrgId: string;
		activeProjectId: string | null;
	};
	type DialogMode =
		| 'create-project'
		| 'rename-project'
		| 'archive-project'
		| 'create-workspace'
		| 'rename-workspace'
		| 'leave-workspace';

	let current = $state<CurrentOrg | null>(null);
	let switcher = $state<SwitcherState | null>(null);
	let loading = $state(false);
	let switching = $state(false);
	let dialogOpen = $state(false);
	let dialogMode = $state<DialogMode>('create-project');
	let selectedProject = $state<ProjectSummary | null>(null);
	let selectedOrg = $state<OrganizationListItem | null>(null);
	let projectName = $state('');
	let workspaceName = $state('');
	let submitting = $state(false);
	let loadError = $state<string | null>(null);
	let dialogError = $state<string | null>(null);

	const activeOrg = $derived.by(() => {
		const state = switcher;
		return state
			? (state.organizations.find((item) => item.organization.id === state.activeOrgId) ?? null)
			: null;
	});
	const activeProjects = $derived(
		activeOrg?.projects.filter((project) => !project.archivedAt) ?? []
	);
	const isAdmin = $derived(current?.membership.role === 'admin');

	async function load() {
		loading = true;
		loadError = null;
		try {
			const [orgRes, switcherRes] = await Promise.all([
				fetch('/api/orgs/current'),
				fetch('/api/orgs')
			]);
			const orgBody = await orgRes.json().catch(() => ({}));
			const switcherBody = await switcherRes.json().catch(() => ({}));
			if (!orgRes.ok) throw new Error(orgBody.error ?? 'Failed to load active workspace.');
			if (!switcherRes.ok) throw new Error(switcherBody.error ?? 'Failed to load workspaces.');
			current = orgBody as CurrentOrg;
			switcher = switcherBody as SwitcherState;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load workspaces.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function afterTenantChange(body: CurrentOrg) {
		current = body;
		clearWorkspaceCache();
		await load();
		await invalidateAll();
		emitProjectChange({
			projectId: body.project.id,
			projectName: body.project.name,
			projectFolder: body.project.projectFolder ?? null
		});
	}

	async function activateOrg(orgId: string) {
		if (orgId === current?.organization.id || switching) return;
		switching = true;
		try {
			await flushPendingSave();
			const res = await fetch(`/api/orgs/${orgId}/activate`, { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Failed to switch workspace.');
			await afterTenantChange(body as CurrentOrg);
			toast.success(`Switched to ${body.organization.name}.`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to switch workspace.');
		} finally {
			switching = false;
		}
	}

	async function activateProject(projectId: string) {
		if (projectId === current?.project.id || switching) return;
		switching = true;
		try {
			await flushPendingSave();
			const res = await fetch(`/api/projects/${projectId}/activate`, { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Failed to switch project.');
			await afterTenantChange(body as CurrentOrg);
			toast.success(`Switched to ${body.project.name}.`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to switch project.');
		} finally {
			switching = false;
		}
	}

	function openDialog(
		mode: DialogMode,
		opts: { project?: ProjectSummary; org?: OrganizationListItem } = {}
	) {
		dialogError = null;
		dialogMode = mode;
		selectedProject = opts.project ?? null;
		selectedOrg = opts.org ?? activeOrg;
		projectName = opts.project?.name ?? '';
		workspaceName = opts.org?.organization.name ?? current?.organization.name ?? '';
		if (mode === 'create-workspace') {
			workspaceName = '';
			projectName = 'Starter project';
		}
		if (mode === 'create-project') projectName = '';
		dialogOpen = true;
	}

	async function submitDialog(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		dialogError = null;
		submitting = true;
		try {
			if (
				(dialogMode === 'create-workspace' || dialogMode === 'rename-workspace') &&
				!workspaceName.trim()
			) {
				throw new Error('Workspace name is required.');
			}
			if (
				(dialogMode === 'create-project' || dialogMode === 'rename-project') &&
				!projectName.trim()
			) {
				throw new Error('Project name is required.');
			}
			if (dialogMode === 'create-workspace') {
				const res = await fetch('/api/orgs', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						workspaceName: workspaceName.trim(),
						projectName: projectName.trim()
					})
				});
				const body = await res.json();
				if (!res.ok) throw new Error(body.error ?? 'Failed to create workspace.');
				dialogOpen = false;
				await afterTenantChange(body as CurrentOrg);
				toast.success('Workspace created.');
				return;
			}

			if (dialogMode === 'rename-workspace') {
				const orgId = selectedOrg?.organization.id ?? current?.organization.id;
				if (!orgId) return;
				const res = await fetch(`/api/orgs/${orgId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: workspaceName.trim() })
				});
				const body = await res.json();
				if (!res.ok) throw new Error(body.error ?? 'Failed to rename workspace.');
				dialogOpen = false;
				await load();
				toast.success('Workspace renamed.');
				return;
			}

			if (dialogMode === 'leave-workspace') {
				const orgId = selectedOrg?.organization.id ?? current?.organization.id;
				if (!orgId) return;
				const res = await fetch(`/api/orgs/${orgId}`, { method: 'DELETE' });
				const body = await res.json();
				if (!res.ok) throw new Error(body.error ?? 'Failed to leave workspace.');
				dialogOpen = false;
				if (body.organization && body.project) await afterTenantChange(body as CurrentOrg);
				else await invalidateAll();
				toast.success('Left workspace.');
				return;
			}

			if (dialogMode === 'create-project') {
				const res = await fetch('/api/projects', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: projectName.trim() })
				});
				const body = await res.json();
				if (!res.ok) throw new Error(body.error ?? 'Failed to create project.');
				dialogOpen = false;
				await activateProject(body.project.id);
				return;
			}

			if (!selectedProject) return;
			if (dialogMode === 'rename-project') {
				const res = await fetch(`/api/projects/${selectedProject.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: projectName.trim() })
				});
				const body = await res.json();
				if (!res.ok) throw new Error(body.error ?? 'Failed to rename project.');
				dialogOpen = false;
				await load();
				await invalidateAll();
				toast.success('Project renamed.');
				return;
			}

			if (selectedProject.id === current?.project.id && activeProjects.length <= 1) {
				throw new Error('Create or switch to another project before archiving this one.');
			}
			const replacement = activeProjects.find((project) => project.id !== selectedProject?.id);
			const res = await fetch(`/api/projects/${selectedProject.id}`, { method: 'DELETE' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Failed to archive project.');
			dialogOpen = false;
			if (selectedProject.id === current?.project.id && replacement)
				await activateProject(replacement.id);
			else {
				await load();
				await invalidateAll();
			}
			toast.success('Project archived.');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Workspace action failed.';
			dialogError = message;
			toast.error(message);
		} finally {
			submitting = false;
		}
	}

	const submitDisabled = $derived(
		submitting ||
			((dialogMode === 'create-workspace' || dialogMode === 'rename-workspace') &&
				!workspaceName.trim()) ||
			((dialogMode === 'create-project' || dialogMode === 'rename-project') &&
				!projectName.trim())
	);
</script>

<DropdownMenu.Root onOpenChange={(open) => open && void load()}>
	<DropdownMenu.Trigger
		data-testid="project-switcher"
		class="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
		disabled={loading || switching}
	>
		<FolderKanban class="h-3.5 w-3.5" />
		<span class="max-w-44 truncate">
			{current ? `${current.organization.name} / ${current.project.name}` : 'Workspace'}
		</span>
		<ChevronsUpDown class="h-3 w-3 text-muted-foreground" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-[min(24rem,calc(100vw-2rem))]">
		{#if loading && !switcher}
			<div class="space-y-1 p-2">
				<div class="h-8 rounded-md bg-muted/60"></div>
				<div class="h-8 rounded-md bg-muted/40"></div>
			</div>
		{:else if loadError}
			<div class="space-y-2 p-2">
				<p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{loadError}
				</p>
				<Button variant="outline" size="sm" class="h-7 text-xs" onclick={load}>Retry</Button>
			</div>
		{:else if switcher}
			{#each switcher.organizations as item (item.organization.id)}
				<DropdownMenu.Label>
					<div class="flex items-start gap-2">
						<button
							class="min-w-0 flex-1 text-left"
							disabled={switching}
							onclick={() => activateOrg(item.organization.id)}
						>
							<p class="truncate text-xs font-medium">
								{item.organization.name}
								{#if item.organization.id === switcher.activeOrgId}
									<span class="text-muted-foreground"> · active</span>
								{/if}
							</p>
							<p class="text-2xs text-muted-foreground">
								{item.membership.role} · {item.organization.plan}
							</p>
						</button>
						{#if item.organization.id === current?.organization.id && item.membership.role === 'admin'}
							<button
								class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
								title="Rename workspace"
								onclick={() => openDialog('rename-workspace', { org: item })}
							>
								<Pencil class="h-3.5 w-3.5" />
							</button>
						{/if}
					</div>
				</DropdownMenu.Label>
				{#each item.projects as project (project.id)}
					<DropdownMenu.Item
						onclick={() =>
							item.organization.id === current?.organization.id
								? activateProject(project.id)
								: activateOrg(item.organization.id)}
						class="gap-2 pl-5"
						disabled={switching}
					>
						{#if project.id === current?.project.id}
							<Check class="h-3.5 w-3.5" />
						{:else}
							<span class="h-3.5 w-3.5"></span>
						{/if}
						<span class="min-w-0 flex-1 truncate">{project.name}</span>
					</DropdownMenu.Item>
					{#if item.organization.id === current?.organization.id && isAdmin}
						<div class="flex gap-1 px-12 pb-1">
							<button
								class="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
								disabled={switching}
								onclick={() => openDialog('rename-project', { project })}
							>
								<Pencil class="h-3 w-3" /> Rename
							</button>
							<button
								class="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
								disabled={switching}
								onclick={() => openDialog('archive-project', { project })}
							>
								<Archive class="h-3 w-3" /> Archive
							</button>
						</div>
					{/if}
				{/each}
				<DropdownMenu.Separator />
			{/each}
			{#if isAdmin}
				<DropdownMenu.Item onclick={() => openDialog('create-project')}>
					<Plus class="h-3.5 w-3.5" /> Create project
				</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Item onclick={() => openDialog('create-workspace')}>
				<Users class="h-3.5 w-3.5" /> Create workspace
			</DropdownMenu.Item>
			{#if current}
				<DropdownMenu.Item onclick={() => openDialog('leave-workspace')} class="text-destructive">
					<LogOut class="h-3.5 w-3.5" /> Leave current workspace
				</DropdownMenu.Item>
			{/if}
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="max-w-md" data-testid="project-dialog">
		<form onsubmit={submitDialog}>
			<Dialog.Header>
				<Dialog.Title>
					{#if dialogMode === 'create-workspace'}
						Create workspace
					{:else if dialogMode === 'rename-workspace'}
						Rename workspace
					{:else if dialogMode === 'leave-workspace'}
						Leave workspace
					{:else if dialogMode === 'create-project'}
						Create project
					{:else if dialogMode === 'rename-project'}
						Rename project
					{:else}
						Archive project
					{/if}
				</Dialog.Title>
				<Dialog.Description>
					{#if dialogMode === 'leave-workspace'}
						You will lose access to this workspace unless another admin invites you again.
					{:else if dialogMode === 'archive-project'}
						{selectedProject?.name} will be hidden from the active project list.
					{:else}
						Workspaces contain projects, connections, team members, shares, jobs, and usage.
					{/if}
				</Dialog.Description>
			</Dialog.Header>

			{#if dialogError}
				<p class="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{dialogError}
				</p>
			{/if}

			{#if dialogMode === 'create-workspace' || dialogMode === 'rename-workspace'}
				<div class="space-y-3 px-5 py-4">
					<div>
						<label class="mb-1.5 block text-xs font-medium" for="workspace-name"
							>Workspace name</label
						>
						<Input
							id="workspace-name"
							bind:value={workspaceName}
							autocomplete="organization"
							autofocus
						/>
					</div>
					{#if dialogMode === 'create-workspace'}
						<div>
							<label class="mb-1.5 block text-xs font-medium" for="starter-project-name">
								Starter project
							</label>
							<Input id="starter-project-name" bind:value={projectName} autocomplete="off" />
						</div>
					{/if}
				</div>
			{:else if dialogMode === 'create-project' || dialogMode === 'rename-project'}
				<div class="px-5 py-4">
					<label class="mb-1.5 block text-xs font-medium" for="project-name">Project name</label>
					<Input id="project-name" bind:value={projectName} autocomplete="off" autofocus />
				</div>
			{:else}
				<div class="px-5 py-4 text-sm text-muted-foreground">
					{#if dialogMode === 'archive-project' && selectedProject?.id === current?.project.id}
						Lunapad will switch to another active project after archiving this one.
					{:else if dialogMode === 'leave-workspace'}
						If you are the last admin, Lunapad will block this action.
					{:else}
						The current project will stay active.
					{/if}
				</div>
			{/if}

			<Dialog.Footer class="gap-2 px-5 pb-5">
				<Button type="button" variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
				<Button
					type="submit"
					variant={dialogMode === 'archive-project' || dialogMode === 'leave-workspace'
						? 'destructive'
						: 'default'}
					disabled={submitDisabled}
				>
					{#if dialogMode === 'create-workspace'}
						Create workspace
					{:else if dialogMode === 'rename-workspace' || dialogMode === 'rename-project'}
						Save changes
					{:else if dialogMode === 'leave-workspace'}
						Leave workspace
					{:else if dialogMode === 'archive-project'}
						Archive project
					{:else}
						Create project
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
