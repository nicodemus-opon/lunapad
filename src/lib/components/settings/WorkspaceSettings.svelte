<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';

	type CurrentOrg = {
		organization: { id: string; name: string; slug: string; plan: string };
		membership: { role: 'admin' | 'editor' | 'viewer' };
	};

	let current = $state<CurrentOrg | null>(null);
	let workspaceName = $state('');
	let loading = $state(true);
	let saving = $state(false);

	const isAdmin = $derived(current?.membership.role === 'admin');

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/orgs/current');
			if (res.ok) {
				current = (await res.json()) as CurrentOrg;
				workspaceName = current.organization.name;
			}
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (!current || !workspaceName.trim()) return;
		saving = true;
		try {
			const res = await fetch(`/api/orgs/${current.organization.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: workspaceName.trim() })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Failed to rename workspace.');
			toast.success('Workspace renamed.');
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to rename workspace.');
		} finally {
			saving = false;
		}
	}

	onMount(load);
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-sm font-semibold">Workspace</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			This workspace owns projects, team members, connections, shares, jobs, and usage.
		</p>
	</div>

	{#if loading}
		<div class="h-8 rounded-md bg-muted/60"></div>
	{:else if current}
		<div class="space-y-3 rounded-md border border-border p-4">
			<div class="grid gap-3 sm:grid-cols-[1fr_auto]">
				<div class="space-y-1">
					<label for="workspace-settings-name" class="text-xs text-muted-foreground">Name</label>
					<Input
						id="workspace-settings-name"
						class="h-8 text-xs"
						bind:value={workspaceName}
						disabled={!isAdmin}
					/>
				</div>
				<div class="space-y-1">
					<p class="text-xs text-muted-foreground">Plan</p>
					<p class="h-8 rounded-md border border-border px-3 py-2 text-xs">{current.organization.plan}</p>
				</div>
			</div>
			<Button size="sm" class="h-8 text-xs" disabled={!isAdmin || saving} onclick={save}>
				{saving ? 'Saving…' : 'Save workspace'}
			</Button>
		</div>
	{/if}
</div>
