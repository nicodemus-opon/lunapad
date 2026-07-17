<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let password = $state('');
	let name = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);
	let inviteState = $state<
		'pending' | 'accepted' | 'expired' | 'revoked' | 'login_required' | 'wrong_email'
	>('pending');

	$effect(() => {
		if (data.state !== 'pending') inviteState = data.state;
	});

	async function acceptInvite() {
		error = null;
		loading = true;
		try {
			const res = await fetch(`/api/invitations/${data.token}/accept`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password, name })
			});
			const body = await res.json();
			if (body.state === 'login_required' && body.loginUrl) {
				window.location.href = body.loginUrl;
				return;
			}
			if (!res.ok) throw new Error(body.error ?? body.message ?? 'Could not accept invite');
			inviteState = body.state ?? 'accepted';
			window.location.href = '/';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not accept invite';
		} finally {
			loading = false;
		}
	}

	function signInForInvite() {
		const redirectTo = `/invite/${encodeURIComponent(data.token)}`;
		window.location.href = `/login?inviteToken=${encodeURIComponent(data.token)}&email=${encodeURIComponent(data.invitation.email)}&redirectTo=${encodeURIComponent(redirectTo)}`;
	}

	function stateMessage(state: typeof inviteState): string {
		if (state === 'accepted') return 'This invitation has already been accepted.';
		if (state === 'expired') return 'This invitation has expired. Ask an admin for a new invite.';
		if (state === 'revoked') return 'This invitation was revoked by a workspace admin.';
		if (state === 'wrong_email') return 'Sign in with the email address this invitation was sent to.';
		if (state === 'login_required') return 'Sign in before accepting this invitation.';
		return '';
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void acceptInvite();
		}}
		class="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<div>
			<h1 class="font-serif text-lg">Join the workspace</h1>
			<p class="mt-1 text-xs text-muted-foreground">
				Invited as <span class="font-medium text-foreground">{data.invitation.role}</span> ·
				{data.invitation.email}
			</p>
		</div>

		{#if inviteState !== 'pending'}
			<p class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
				{stateMessage(inviteState)}
			</p>
		{:else if data.currentUser}
			<p class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
				Signed in as <span class="font-medium text-foreground">{data.currentUser.email}</span>.
				Accepting will switch Lunapad to this workspace.
			</p>
		{:else}
			<div>
				<label
					for="invite-name"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Display name</label
				>
				<Input id="invite-name" class="h-8 text-xs" bind:value={name} placeholder="Your name" />
			</div>
			<div>
				<label
					for="invite-password"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Password</label
				>
				<Input
					id="invite-password"
					type="password"
					class="h-8 text-xs"
					bind:value={password}
					required
					autocomplete="new-password"
				/>
			</div>
		{/if}
		{#if error}
			<p class="text-xs text-destructive">{error}</p>
		{/if}
		{#if inviteState === 'pending'}
			<Button type="submit" class="w-full" disabled={loading || (!data.currentUser && !password)}>
				{loading ? 'Joining…' : data.currentUser ? 'Accept invitation' : 'Create account'}
			</Button>
			{#if !data.currentUser}
				<Button type="button" variant="ghost" class="w-full" onclick={signInForInvite}>
					I already have an account
				</Button>
			{/if}
		{:else if inviteState === 'login_required' || inviteState === 'wrong_email'}
			<Button type="button" class="w-full" onclick={signInForInvite}>Sign in for this invite</Button>
		{/if}
	</form>
</div>
