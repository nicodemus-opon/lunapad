<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';

	type ProjectSummary = {
		id: string;
		name: string;
		slug: string;
		projectFolder?: string | null;
		archivedAt: string | null;
	};

	let projects = $state<ProjectSummary[]>([]);
	let activeProjectId = $state<string | null>(null);
	let newProjectName = $state('');
	let loading = $state(true);
	let creating = $state(false);

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/projects');
			if (res.ok) {
				const body = (await res.json()) as { projects: ProjectSummary[]; activeProjectId: string | null };
				projects = body.projects;
				activeProjectId = body.activeProjectId;
			}
		} finally {
			loading = false;
		}
	}

	async function createProject() {
		if (!newProjectName.trim()) return;
		creating = true;
		try {
			const res = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newProjectName.trim() })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Failed to create project.');
			newProjectName = '';
			toast.success('Project created.');
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create project.');
		} finally {
			creating = false;
		}
	}

	onMount(load);
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-sm font-semibold">Projects</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			Projects separate notebooks, comments, shares, schedules, jobs, and usage inside a workspace.
		</p>
	</div>

	<div class="flex gap-2">
		<Input
			class="h-8 text-xs"
			bind:value={newProjectName}
			placeholder="New project name"
			autocomplete="off"
		/>
		<Button size="sm" class="h-8 text-xs" disabled={creating || !newProjectName.trim()} onclick={createProject}>
			{creating ? 'Creating…' : 'Create project'}
		</Button>
	</div>

	{#if loading}
		<div class="space-y-1">
			<div class="h-8 rounded-md bg-muted/60"></div>
			<div class="h-8 rounded-md bg-muted/40"></div>
		</div>
	{:else if projects.length === 0}
		<p class="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
			No projects yet. Create one to start a notebook workspace.
		</p>
	{:else}
		<div class="overflow-hidden rounded-md border border-border">
			<table class="w-full text-xs">
				<thead class="bg-muted/40 text-muted-foreground">
					<tr>
						<th class="px-3 py-2 text-left font-medium">Name</th>
						<th class="px-3 py-2 text-left font-medium">Status</th>
						<th class="px-3 py-2 text-left font-medium">Folder</th>
					</tr>
				</thead>
				<tbody>
					{#each projects as project (project.id)}
						<tr class="border-t border-border">
							<td class="px-3 py-2">{project.name}</td>
							<td class="px-3 py-2 text-muted-foreground">
								{project.id === activeProjectId ? 'Active' : 'Available'}
							</td>
							<td class="px-3 py-2 font-mono text-muted-foreground">
								{project.projectFolder ?? 'Not recorded'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
