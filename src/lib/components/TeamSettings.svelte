<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';
	import { Trash2 } from '@lucide/svelte';

	type AdminUser = { id: string; name: string; email: string; role?: string | null };

	let users = $state<AdminUser[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let name = $state('');
	let email = $state('');
	let password = $state('');

	async function loadUsers() {
		loading = true;
		try {
			const { data, error } = await authClient.admin.listUsers({ query: {} });
			if (error) {
				toast.error(error.message ?? 'Failed to load users.');
				return;
			}
			users = (data?.users ?? []) as AdminUser[];
		} finally {
			loading = false;
		}
	}

	onMount(loadUsers);

	async function handleCreate(event: SubmitEvent) {
		event.preventDefault();
		creating = true;
		try {
			const { error } = await authClient.admin.createUser({ name, email, password });
			if (error) {
				toast.error(error.message ?? 'Failed to create user.');
				return;
			}
			toast.success(`${email} can now sign in.`);
			name = '';
			email = '';
			password = '';
			await loadUsers();
		} finally {
			creating = false;
		}
	}

	async function handleRemove(user: AdminUser) {
		if (!confirm(`Remove ${user.email}? They will lose access immediately.`)) return;
		const { error } = await authClient.admin.removeUser({ userId: user.id });
		if (error) {
			toast.error(error.message ?? 'Failed to remove user.');
			return;
		}
		toast.success(`${user.email} removed.`);
		await loadUsers();
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-sm font-semibold">Team members</h1>
		<p class="mt-1 text-xs text-muted-foreground">
			Sign-up is closed for this shared instance — add teammates here instead.
		</p>
	</div>

	<form onsubmit={handleCreate} class="space-y-3 rounded-lg border border-border bg-card p-4">
		<h2 class="text-2xs tracking-wide text-muted-foreground uppercase">Add a teammate</h2>
		<div class="grid grid-cols-3 gap-2">
			<Input class="h-8 text-xs" bind:value={name} placeholder="Name" required autocomplete="off" />
			<Input
				class="h-8 text-xs"
				type="email"
				bind:value={email}
				placeholder="Email"
				required
				autocomplete="off"
			/>
			<Input
				class="h-8 text-xs"
				type="password"
				bind:value={password}
				placeholder="Temporary password"
				required
				minlength={8}
				autocomplete="new-password"
			/>
		</div>
		<Button type="submit" disabled={creating} class="w-full">
			{creating ? 'Adding…' : 'Add teammate'}
		</Button>
	</form>

	<div class="space-y-2">
		{#if loading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if users.length === 0}
			<p class="text-sm text-muted-foreground">No users yet.</p>
		{:else}
			<table class="w-full text-xs">
				<thead>
					<tr class="border-b border-border text-2xs tracking-wide text-muted-foreground uppercase">
						<th class="py-1.5 text-left">Name</th>
						<th class="py-1.5 text-left">Email</th>
						<th class="py-1.5 text-left">Role</th>
						<th class="py-1.5"></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user (user.id)}
						<tr class="border-b border-border">
							<td class="py-1.5">{user.name}</td>
							<td class="py-1.5 font-mono">{user.email}</td>
							<td class="py-1.5">{user.role ?? 'user'}</td>
							<td class="py-1.5 text-right">
								<Button
									variant="ghost"
									size="icon"
									class="size-6"
									onclick={() => handleRemove(user)}
									title="Remove user"
								>
									<Trash2 class="size-3.5" />
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
