<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import { Copy, RefreshCw, Trash2 } from '@lucide/svelte';

	type Role = 'admin' | 'editor' | 'viewer';
	type TeamUser = { id: string; name: string; email: string; role: Role; mention: string };
	type Invitation = {
		id: string;
		email: string;
		role: Role;
		token: string;
		expiresAt: string;
		acceptedAt: string | null;
		acceptedBy: string | null;
		revokedAt: string | null;
	};

	let users = $state<TeamUser[]>([]);
	let invitations = $state<Invitation[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let email = $state('');
	let role = $state<Role>('editor');
	let loadError = $state<string | null>(null);
	let updatingUserId = $state<string | null>(null);
	let revokingInvitationId = $state<string | null>(null);

	async function load() {
		loading = true;
		loadError = null;
		try {
			const [usersRes, invitesRes] = await Promise.all([
				fetch('/api/team/users'),
				fetch('/api/invitations')
			]);
			const usersBody = await usersRes.json().catch(() => ({}));
			const invitesBody = await invitesRes.json().catch(() => ({}));
			if (!usersRes.ok) throw new Error(usersBody.error ?? 'Failed to load team members.');
			if (!invitesRes.ok) throw new Error(invitesBody.error ?? 'Failed to load invitations.');
			users = (usersBody as { users?: TeamUser[] }).users ?? [];
			invitations = (invitesBody as { invitations?: Invitation[] }).invitations ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load team settings.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function invite(event: SubmitEvent) {
		event.preventDefault();
		creating = true;
		try {
			const res = await fetch('/api/invitations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role })
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to invite teammate.');
				return;
			}
			toast.success(`${email} invited.`);
			email = '';
			role = 'editor';
			await load();
		} finally {
			creating = false;
		}
	}

	async function updateRole(user: TeamUser, nextRole: Role) {
		updatingUserId = user.id;
		try {
			const res = await fetch('/api/team/users', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: user.id, role: nextRole })
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to update role.');
				return;
			}
			toast.success('Role updated.');
			await load();
		} finally {
			updatingUserId = null;
		}
	}

	async function revoke(invitation: Invitation) {
		revokingInvitationId = invitation.id;
		try {
			const res = await fetch(`/api/invitations?id=${encodeURIComponent(invitation.id)}`, {
				method: 'DELETE'
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to revoke invitation.');
				return;
			}
			toast.success('Invitation revoked.');
			await load();
		} finally {
			revokingInvitationId = null;
		}
	}

	function invitationState(invitation: Invitation): 'accepted' | 'revoked' | 'expired' | 'pending' {
		if (invitation.acceptedAt) return 'accepted';
		if (invitation.revokedAt) return 'revoked';
		if (new Date(invitation.expiresAt).getTime() < Date.now()) return 'expired';
		return 'pending';
	}

	async function copyInvite(invitation: Invitation) {
		try {
			await navigator.clipboard.writeText(`${window.location.origin}/invite/${invitation.token}`);
			toast.success('Invite link copied.');
		} catch {
			toast.error('Could not copy invite link.');
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-start justify-between gap-3">
		<div>
			<h2 class="text-sm font-semibold">Team</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				Workspace roles apply to every project, shared report, comment, and data source here.
			</p>
		</div>
		<Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" disabled={loading} onclick={load}>
			<RefreshCw class="h-3.5 w-3.5" /> Refresh
		</Button>
	</div>

	{#if loadError}
		<div class="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
			<p class="text-xs text-destructive">{loadError}</p>
			<Button variant="outline" size="sm" class="h-7 text-xs" onclick={load}>Retry</Button>
		</div>
	{/if}

	<form onsubmit={invite} class="space-y-3 rounded-md border border-border bg-card p-4">
		<h2 class="text-xs font-semibold">Invite teammate</h2>
		<div class="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
			<Input
				class="h-8 text-xs"
				type="email"
				bind:value={email}
				placeholder="name@example.com"
				required
				autocomplete="off"
			/>
			<select
				bind:value={role}
				class="h-8 rounded-md border border-input bg-background px-2 text-xs"
			>
				<option value="admin">Admin</option>
				<option value="editor">Editor</option>
				<option value="viewer">Viewer</option>
			</select>
			<Button type="submit" disabled={creating} size="sm" class="h-8 text-xs">
				{creating ? 'Inviting…' : 'Send invite'}
			</Button>
		</div>
	</form>

	<div class="space-y-2">
		<h2 class="text-xs font-semibold">Members</h2>
		{#if loading}
			<div class="space-y-1">
				<div class="h-8 rounded-md bg-muted/60"></div>
				<div class="h-8 rounded-md bg-muted/40"></div>
			</div>
		{:else if users.length === 0}
			<p class="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
				No members yet. Invite your data team to share notebooks, comments, connections, and published work.
			</p>
		{:else}
			<div class="overflow-x-auto rounded-md border border-border">
				<table class="w-full min-w-[34rem] text-xs">
					<thead class="bg-muted/40 text-muted-foreground">
						<tr>
							<th class="px-3 py-2 text-left font-medium">Name</th>
							<th class="px-3 py-2 text-left font-medium">Email</th>
							<th class="px-3 py-2 text-left font-medium">Role</th>
						</tr>
					</thead>
					<tbody>
						{#each users as user (user.id)}
							<tr class="border-t border-border">
								<td class="px-3 py-2">{user.name}</td>
								<td class="px-3 py-2 font-mono">{user.email}</td>
								<td class="px-3 py-2">
									<select
										value={user.role}
										class="h-7 rounded-md border border-input bg-background px-2 text-xs"
										disabled={updatingUserId === user.id}
										onchange={(e) =>
											updateRole(user, (e.currentTarget as HTMLSelectElement).value as Role)}
									>
										<option value="admin">Admin</option>
										<option value="editor">Editor</option>
										<option value="viewer">Viewer</option>
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div class="space-y-2">
		<h2 class="text-xs font-semibold">Invitations</h2>
		{#if invitations.length === 0}
			<p class="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
				No invitations yet. Send an invite to add a teammate to this workspace.
			</p>
		{:else}
			<div class="space-y-1">
				{#each invitations as invitation (invitation.id)}
					<div class="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
						<div class="min-w-0 flex-1">
							<p class="truncate font-mono">{invitation.email}</p>
							<p class="text-muted-foreground">
								{invitation.role} · {invitationState(invitation)} · expires {new Date(
									invitation.expiresAt
								).toLocaleDateString()}
							</p>
						</div>
						{#if invitationState(invitation) === 'pending'}
							<Button
								variant="ghost"
								size="sm"
								class="h-7 gap-1.5 text-xs"
								onclick={() => copyInvite(invitation)}
							>
								<Copy class="h-3.5 w-3.5" /> Copy link
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 text-xs"
								disabled
								title="Email delivery is not configured yet"
							>
								Resend
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="size-6"
								disabled={revokingInvitationId === invitation.id}
								title="Revoke invitation"
								onclick={() => revoke(invitation)}
							>
								<Trash2 class="size-3.5" />
							</Button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
